<?php
/**
 * Shortcode [federhall] and the "Federhall Player" block.
 *
 * @package Federhall
 */

defined( 'ABSPATH' ) || exit;

class Federhall_Frontend {

	private static $instance = 0;

	public static function init() {
		add_shortcode( 'federhall', array( __CLASS__, 'shortcode' ) );
		add_action( 'init', array( __CLASS__, 'register' ) );
	}

	public static function register() {
		wp_register_style( 'federhall', FEDERHALL_URL . 'assets/css/federhall.css', array(), FEDERHALL_VERSION );
		wp_register_script( 'federhall', FEDERHALL_URL . 'assets/js/federhall-player.js', array(), FEDERHALL_VERSION, true );

		wp_register_script(
			'federhall-block-editor',
			FEDERHALL_URL . 'blocks/player/index.js',
			array( 'wp-blocks', 'wp-element', 'wp-block-editor', 'wp-components', 'wp-i18n' ),
			FEDERHALL_VERSION,
			true
		);
		add_action( 'enqueue_block_editor_assets', array( __CLASS__, 'editor_data' ) );

		if ( function_exists( 'register_block_type' ) ) {
			register_block_type(
				FEDERHALL_DIR . 'blocks/player',
				array( 'render_callback' => array( __CLASS__, 'render_block' ) )
			);
		}
	}

	public static function editor_data() {
		$tracks = array();
		foreach ( Federhall_DB::get_tracks( array( 'active_only' => true ) ) as $row ) {
			$tracks[] = array(
				'id'     => (int) $row->id,
				'title'  => $row->title,
				'artist' => $row->artist,
			);
		}
		$data = array(
			'tracks'   => $tracks,
			'preview'  => FEDERHALL_URL . 'assets/img/background.jpg',
			'adminUrl' => current_user_can( 'upload_files' ) ? admin_url( 'admin.php?page=federhall' ) : '',
		);
		wp_add_inline_script( 'federhall-block-editor', 'window.federhallEditor = ' . wp_json_encode( $data ) . ';', 'before' );
	}

	public static function render_block( $attributes ) {
		$atts = array(
			'tracks' => isset( $attributes['tracks'] ) ? (string) $attributes['tracks'] : '',
			'track'  => isset( $attributes['track'] ) ? (string) $attributes['track'] : '',
			'width'  => ! empty( $attributes['width'] ) ? (string) $attributes['width'] : '',
		);
		$html = self::shortcode( $atts );
		$wrap = function_exists( 'get_block_wrapper_attributes' ) ? get_block_wrapper_attributes() : 'class="wp-block-federhall-player"';
		return '<div ' . $wrap . '>' . $html . '</div>';
	}

	/**
	 * [federhall tracks="3,7,9" track="7" width="900"]
	 *
	 * tracks: only these track ids (in this order). track: start with this id.
	 * width: maximum width in pixels.
	 */
	public static function shortcode( $atts ) {
		$atts     = shortcode_atts( array( 'tracks' => '', 'track' => '', 'width' => '' ), $atts, 'federhall' );
		$settings = Federhall_Settings::get();
		$ids      = array_filter( array_map( 'absint', explode( ',', (string) $atts['tracks'] ) ) );

		$tracks = array();
		foreach ( Federhall_DB::get_tracks( array( 'active_only' => true, 'ids' => $ids ) ) as $row ) {
			$url = wp_get_attachment_url( (int) $row->attachment_id );
			if ( ! $url ) {
				continue;
			}
			$meta     = wp_get_attachment_metadata( (int) $row->attachment_id );
			$tracks[] = array(
				'id'          => (int) $row->id,
				'title'       => $row->title,
				'artist'      => $row->artist,
				'description' => (string) $row->description,
				'url'         => $url,
				'duration'    => is_array( $meta ) && ! empty( $meta['length'] ) ? (int) $meta['length'] : 0,
				'likes'       => $settings['show_like_count'] ? (int) $row->likes : 0,
				'plays'       => $settings['show_plays'] ? (int) $row->plays : 0,
				'liked'       => false,
			);
		}

		$config = array(
			'assetsUrl'  => FEDERHALL_URL . 'assets/img/',
			'workletUrl' => FEDERHALL_URL . 'assets/js/federhall-worklet.js?ver=' . FEDERHALL_VERSION,
			'restUrl'    => esc_url_raw( rest_url( Federhall_REST::NS . '/' ) ),
			'tracks'     => $tracks,
			'startTrack' => absint( $atts['track'] ),
			'defaults'   => Federhall_Settings::engine_defaults( $settings ),
			'options'    => array(
				'likes'         => (bool) $settings['likes'],
				'showLikeCount' => (bool) $settings['show_like_count'],
				'showPlays'     => (bool) $settings['show_plays'],
				'record'        => (bool) $settings['record'],
				'autoNext'      => (bool) $settings['auto_next'],
				'loop'          => $settings['loop'],
				'hint'          => $settings['hint'],
			),
			'i18n'       => self::strings(),
		);

		wp_enqueue_style( 'federhall' );
		wp_enqueue_script( 'federhall' );

		$width = absint( $atts['width'] ) ? absint( $atts['width'] ) : (int) $settings['max_width'];
		++self::$instance;

		return sprintf(
			'<div class="federhall" id="federhall-%1$d" style="--fh-max:%2$dpx" data-federhall="%3$s"><noscript>%4$s</noscript></div>',
			self::$instance,
			$width,
			esc_attr( wp_json_encode( $config ) ),
			esc_html__( 'Für den Federhall wird JavaScript benötigt.', 'federhall' )
		);
	}

	private static function strings() {
		return array(
			'chooseTrack'  => __( 'Titel wählen', 'federhall' ),
			'noTracks'     => __( 'Noch keine Titel vorhanden', 'federhall' ),
			'play'         => __( 'Abspielen', 'federhall' ),
			'pause'        => __( 'Pause', 'federhall' ),
			'prev'         => __( 'Vorheriger Titel', 'federhall' ),
			'next'         => __( 'Nächster Titel', 'federhall' ),
			'position'     => __( 'Position', 'federhall' ),
			'like'         => __( 'Gefällt mir', 'federhall' ),
			'unlike'       => __( 'Gefällt mir nicht mehr', 'federhall' ),
			'plays'        => __( 'mal gespielt', 'federhall' ),
			'bypassTitle'  => __( 'Effekt aus/an (A/B-Vergleich)', 'federhall' ),
			'resetTitle'   => __( 'Regler zurücksetzen', 'federhall' ),
			'recordTitle'  => __( 'Aufnahme starten (mit Effekt)', 'federhall' ),
			'recordStop'   => __( 'Aufnahme beenden und speichern', 'federhall' ),
			'recordStart'  => __( 'Aufnahme läuft. Nochmal klicken zum Speichern.', 'federhall' ),
			'recordDone'   => __( 'Aufnahme gespeichert.', 'federhall' ),
			'recordError'  => __( 'Aufnahme wird von diesem Browser nicht unterstützt.', 'federhall' ),
			'tankLabel'    => __( 'Federn: antippen, drüberstreichen oder entlangkratzen', 'federhall' ),
			'noAudio'      => __( 'Dein Browser unterstützt kein Web Audio.', 'federhall' ),
			'noWorklet'    => __( 'Dein Browser kann den Federhall nicht berechnen, der Titel läuft ohne Effekt.', 'federhall' ),
			'playError'    => __( 'Der Titel konnte nicht abgespielt werden.', 'federhall' ),
			'likeError'    => __( 'Like konnte nicht gespeichert werden.', 'federhall' ),
			'loadError'    => __( 'Grafik konnte nicht geladen werden.', 'federhall' ),
		);
	}
}
