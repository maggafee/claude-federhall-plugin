<?php
/**
 * Public REST endpoints for the player: track stats, likes and play counts.
 *
 * Visitors are identified by a random id their browser keeps in
 * localStorage (or, if configured, by their IP address). Only a salted hash
 * of it is stored, never the raw id or IP.
 *
 * @package Federhall
 */

defined( 'ABSPATH' ) || exit;

class Federhall_REST {

	const NS = 'federhall/v1';

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
	}

	public static function routes() {
		register_rest_route(
			self::NS,
			'/tracks',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'tracks' ),
				'permission_callback' => '__return_true',
				'args'                => array(
					'vid' => array( 'type' => 'string', 'default' => '' ),
					'ids' => array( 'type' => 'string', 'default' => '' ),
				),
			)
		);
		register_rest_route(
			self::NS,
			'/like',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'like' ),
				'permission_callback' => '__return_true',
				'args'                => array(
					'track' => array( 'type' => 'integer', 'required' => true ),
					'vid'   => array( 'type' => 'string', 'default' => '' ),
				),
			)
		);
		register_rest_route(
			self::NS,
			'/play',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( __CLASS__, 'play' ),
				'permission_callback' => '__return_true',
				'args'                => array(
					'track' => array( 'type' => 'integer', 'required' => true ),
					'vid'   => array( 'type' => 'string', 'default' => '' ),
				),
			)
		);
	}

	private static function client_ip() {
		return isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '0.0.0.0';
	}

	private static function valid_vid( $vid ) {
		return is_string( $vid ) && preg_match( '/^[a-zA-Z0-9-]{16,64}$/', $vid );
	}

	/** Salted hash identifying the visitor for likes. */
	private static function visitor_key( $vid ) {
		$settings = Federhall_Settings::get();
		if ( 'ip' === $settings['like_mode'] || ! self::valid_vid( $vid ) ) {
			return hash_hmac( 'sha256', 'ip|' . self::client_ip(), wp_salt( 'auth' ) );
		}
		return hash_hmac( 'sha256', 'v|' . $vid, wp_salt( 'auth' ) );
	}

	/** Simple per-IP rate limit so nobody can hammer the counters. */
	private static function rate_limited( $bucket, $max, $window ) {
		$key   = 'federhall_rl_' . $bucket . '_' . substr( hash_hmac( 'sha256', self::client_ip(), wp_salt( 'nonce' ) ), 0, 20 );
		$count = (int) get_transient( $key );
		if ( $count >= $max ) {
			return true;
		}
		set_transient( $key, $count + 1, $window );
		return false;
	}

	private static function no_cache( $response ) {
		$response = rest_ensure_response( $response );
		$response->header( 'Cache-Control', 'no-store, max-age=0' );
		return $response;
	}

	public static function tracks( WP_REST_Request $req ) {
		$ids    = array_filter( array_map( 'absint', explode( ',', (string) $req['ids'] ) ) );
		$rows   = Federhall_DB::get_tracks( array( 'active_only' => true, 'ids' => $ids ) );
		$liked  = Federhall_DB::liked_by( self::visitor_key( (string) $req['vid'] ) );
		$liked  = array_flip( $liked );
		$out    = array();
		$public = Federhall_Settings::get();
		foreach ( $rows as $r ) {
			$out[] = array(
				'id'    => (int) $r->id,
				'likes' => $public['show_like_count'] ? (int) $r->likes : 0,
				'plays' => $public['show_plays'] ? (int) $r->plays : 0,
				'liked' => isset( $liked[ (int) $r->id ] ),
			);
		}
		return self::no_cache( array( 'tracks' => $out ) );
	}

	public static function like( WP_REST_Request $req ) {
		$settings = Federhall_Settings::get();
		if ( ! $settings['likes'] ) {
			return new WP_Error( 'federhall_likes_off', __( 'Likes sind deaktiviert.', 'federhall' ), array( 'status' => 403 ) );
		}
		$track = Federhall_DB::get_track( (int) $req['track'] );
		if ( ! $track || ! $track->active ) {
			return new WP_Error( 'federhall_no_track', __( 'Titel nicht gefunden.', 'federhall' ), array( 'status' => 404 ) );
		}
		if ( self::rate_limited( 'like', 60, 10 * MINUTE_IN_SECONDS ) ) {
			return new WP_Error( 'federhall_slow_down', __( 'Zu viele Klicks, bitte kurz warten.', 'federhall' ), array( 'status' => 429 ) );
		}
		$res = Federhall_DB::toggle_like( (int) $track->id, self::visitor_key( (string) $req['vid'] ) );
		if ( ! $settings['show_like_count'] ) {
			$res['likes'] = 0;
		}
		return self::no_cache( $res );
	}

	public static function play( WP_REST_Request $req ) {
		$track = Federhall_DB::get_track( (int) $req['track'] );
		if ( ! $track || ! $track->active ) {
			return new WP_Error( 'federhall_no_track', __( 'Titel nicht gefunden.', 'federhall' ), array( 'status' => 404 ) );
		}
		// one play per visitor and track every 30 minutes
		$key = 'federhall_play_' . substr( self::visitor_key( (string) $req['vid'] ), 0, 24 ) . '_' . (int) $track->id;
		if ( get_transient( $key ) || self::rate_limited( 'play', 120, HOUR_IN_SECONDS ) ) {
			$plays = (int) $track->plays;
		} else {
			set_transient( $key, 1, 30 * MINUTE_IN_SECONDS );
			$plays = Federhall_DB::add_play( (int) $track->id );
		}
		$settings = Federhall_Settings::get();
		return self::no_cache( array( 'plays' => $settings['show_plays'] ? $plays : 0 ) );
	}
}
