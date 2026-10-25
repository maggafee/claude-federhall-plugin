<?php
/**
 * Tables for tracks and likes, plus the queries the rest of the plugin uses.
 *
 * @package Federhall
 */

defined( 'ABSPATH' ) || exit;

class Federhall_DB {

	public static function tracks_table() {
		global $wpdb;
		return $wpdb->prefix . 'federhall_tracks';
	}

	public static function likes_table() {
		global $wpdb;
		return $wpdb->prefix . 'federhall_likes';
	}

	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$charset = $wpdb->get_charset_collate();
		$tracks  = self::tracks_table();
		$likes   = self::likes_table();

		dbDelta(
			"CREATE TABLE $tracks (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				attachment_id bigint(20) unsigned NOT NULL DEFAULT 0,
				title varchar(255) NOT NULL DEFAULT '',
				artist varchar(255) NOT NULL DEFAULT '',
				description text NULL,
				sort_order int(11) NOT NULL DEFAULT 0,
				active tinyint(1) NOT NULL DEFAULT 1,
				likes int(10) unsigned NOT NULL DEFAULT 0,
				plays int(10) unsigned NOT NULL DEFAULT 0,
				created_at datetime NOT NULL,
				PRIMARY KEY  (id),
				KEY attachment_id (attachment_id),
				KEY sort_order (sort_order)
			) $charset;"
		);
		dbDelta(
			"CREATE TABLE $likes (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				track_id bigint(20) unsigned NOT NULL,
				visitor char(64) NOT NULL,
				created_at datetime NOT NULL,
				PRIMARY KEY  (id),
				UNIQUE KEY track_visitor (track_id,visitor),
				KEY created_at (created_at)
			) $charset;"
		);
		update_option( 'federhall_db_version', FEDERHALL_DB_VERSION );
		if ( false === get_option( Federhall_Settings::OPTION ) ) {
			add_option( Federhall_Settings::OPTION, Federhall_Settings::defaults() );
		}
	}

	public static function maybe_upgrade() {
		if ( get_option( 'federhall_db_version' ) !== FEDERHALL_DB_VERSION ) {
			self::install();
		}
	}

	// ------------------------------------------------------------------ tracks

	/**
	 * @param array $args active_only (bool), ids (int[]), orderby (sort|likes|plays).
	 * @return object[]
	 */
	public static function get_tracks( $args = array() ) {
		global $wpdb;
		$args  = wp_parse_args( $args, array( 'active_only' => false, 'ids' => array(), 'orderby' => 'sort' ) );
		$table = self::tracks_table();
		$where = array( '1=1' );
		if ( $args['active_only'] ) {
			$where[] = 'active = 1';
		}
		$ids = array_filter( array_map( 'absint', (array) $args['ids'] ) );
		if ( $ids ) {
			$where[] = 'id IN (' . implode( ',', $ids ) . ')';
		}
		switch ( $args['orderby'] ) {
			case 'likes':
				$order = 'likes DESC, plays DESC, id ASC';
				break;
			case 'plays':
				$order = 'plays DESC, likes DESC, id ASC';
				break;
			default:
				$order = 'sort_order ASC, id ASC';
		}
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- only integers and fixed strings are interpolated.
		$rows = $wpdb->get_results( "SELECT * FROM $table WHERE " . implode( ' AND ', $where ) . " ORDER BY $order" );

		// keep the order of an explicit id list ("tracks" shortcode attribute)
		if ( $ids && 'sort' === $args['orderby'] ) {
			$pos = array_flip( $ids );
			usort(
				$rows,
				static function ( $a, $b ) use ( $pos ) {
					return $pos[ $a->id ] - $pos[ $b->id ];
				}
			);
		}
		return $rows;
	}

	public static function get_track( $id ) {
		global $wpdb;
		$table = self::tracks_table();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $table WHERE id = %d", $id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	public static function add_track( $attachment_id, $title = '', $artist = '' ) {
		global $wpdb;
		$table = self::tracks_table();
		$max   = (int) $wpdb->get_var( "SELECT MAX(sort_order) FROM $table" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		if ( '' === $title ) {
			$title = self::title_from_attachment( $attachment_id );
		}
		if ( '' === $artist ) {
			$meta   = wp_get_attachment_metadata( $attachment_id );
			$artist = is_array( $meta ) && ! empty( $meta['artist'] ) ? (string) $meta['artist'] : '';
		}
		$wpdb->insert(
			$table,
			array(
				'attachment_id' => (int) $attachment_id,
				'title'         => wp_strip_all_tags( $title ),
				'artist'        => wp_strip_all_tags( $artist ),
				'description'   => '',
				'sort_order'    => $max + 1,
				'active'        => 1,
				'created_at'    => current_time( 'mysql', true ),
			),
			array( '%d', '%s', '%s', '%s', '%d', '%d', '%s' )
		);
		return (int) $wpdb->insert_id;
	}

	public static function title_from_attachment( $attachment_id ) {
		$meta = wp_get_attachment_metadata( $attachment_id );
		if ( is_array( $meta ) && ! empty( $meta['title'] ) ) {
			return (string) $meta['title'];
		}
		$title = get_the_title( $attachment_id );
		return $title ? $title : __( 'Unbenannter Titel', 'federhall' );
	}

	public static function update_track( $id, $data ) {
		global $wpdb;
		$allowed = array(
			'title'       => '%s',
			'artist'      => '%s',
			'description' => '%s',
			'active'      => '%d',
			'sort_order'  => '%d',
		);
		$data    = array_intersect_key( $data, $allowed );
		if ( ! $data ) {
			return false;
		}
		$formats = array();
		foreach ( array_keys( $data ) as $key ) {
			$formats[] = $allowed[ $key ];
		}
		return false !== $wpdb->update( self::tracks_table(), $data, array( 'id' => (int) $id ), $formats, array( '%d' ) );
	}

	public static function delete_track( $id ) {
		global $wpdb;
		$wpdb->delete( self::likes_table(), array( 'track_id' => (int) $id ), array( '%d' ) );
		return (bool) $wpdb->delete( self::tracks_table(), array( 'id' => (int) $id ), array( '%d' ) );
	}

	public static function track_exists_for_attachment( $attachment_id ) {
		global $wpdb;
		$table = self::tracks_table();
		return (bool) $wpdb->get_var( $wpdb->prepare( "SELECT id FROM $table WHERE attachment_id = %d", $attachment_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	public static function add_play( $id ) {
		global $wpdb;
		$table = self::tracks_table();
		$wpdb->query( $wpdb->prepare( "UPDATE $table SET plays = plays + 1 WHERE id = %d", $id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT plays FROM $table WHERE id = %d", $id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	// ------------------------------------------------------------------ likes

	/**
	 * Toggle the like of one visitor for one track.
	 *
	 * @return array{liked: bool, likes: int}
	 */
	public static function toggle_like( $track_id, $visitor ) {
		global $wpdb;
		$likes  = self::likes_table();
		$tracks = self::tracks_table();

		$deleted = $wpdb->delete( $likes, array( 'track_id' => (int) $track_id, 'visitor' => $visitor ), array( '%d', '%s' ) );
		if ( $deleted ) {
			$liked = false;
		} else {
			// INSERT IGNORE: a double click racing itself must not count twice
			$wpdb->query(
				$wpdb->prepare(
					"INSERT IGNORE INTO $likes (track_id, visitor, created_at) VALUES (%d, %s, %s)", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
					$track_id,
					$visitor,
					current_time( 'mysql', true )
				)
			);
			$liked = true;
		}
		$count = self::recount_likes( $track_id );
		return array(
			'liked' => $liked,
			'likes' => $count,
		);
	}

	public static function recount_likes( $track_id ) {
		global $wpdb;
		$likes  = self::likes_table();
		$tracks = self::tracks_table();
		$count  = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $likes WHERE track_id = %d", $track_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$wpdb->update( $tracks, array( 'likes' => $count ), array( 'id' => (int) $track_id ), array( '%d' ), array( '%d' ) );
		return $count;
	}

	/** @return int[] track ids this visitor liked */
	public static function liked_by( $visitor ) {
		global $wpdb;
		$likes = self::likes_table();
		return array_map( 'intval', $wpdb->get_col( $wpdb->prepare( "SELECT track_id FROM $likes WHERE visitor = %s", $visitor ) ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	/** Likes per day for the last $days days: [ 'Y-m-d' => count ]. */
	public static function likes_per_day( $days = 30, $track_id = 0 ) {
		global $wpdb;
		$likes = self::likes_table();
		$since = gmdate( 'Y-m-d 00:00:00', time() - ( $days - 1 ) * DAY_IN_SECONDS );
		$sql   = "SELECT DATE(created_at) d, COUNT(*) c FROM $likes WHERE created_at >= %s";
		$args  = array( $since );
		if ( $track_id ) {
			$sql   .= ' AND track_id = %d';
			$args[] = $track_id;
		}
		$sql .= ' GROUP BY DATE(created_at)';
		$rows = $wpdb->get_results( $wpdb->prepare( $sql, $args ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$out  = array();
		for ( $i = $days - 1; $i >= 0; $i-- ) {
			$out[ gmdate( 'Y-m-d', time() - $i * DAY_IN_SECONDS ) ] = 0;
		}
		foreach ( $rows as $r ) {
			if ( isset( $out[ $r->d ] ) ) {
				$out[ $r->d ] = (int) $r->c;
			}
		}
		return $out;
	}

	public static function reset_stats( $track_id = 0, $what = 'likes' ) {
		global $wpdb;
		$likes  = self::likes_table();
		$tracks = self::tracks_table();
		if ( 'likes' === $what || 'all' === $what ) {
			if ( $track_id ) {
				$wpdb->delete( $likes, array( 'track_id' => (int) $track_id ), array( '%d' ) );
				$wpdb->update( $tracks, array( 'likes' => 0 ), array( 'id' => (int) $track_id ), array( '%d' ), array( '%d' ) );
			} else {
				$wpdb->query( "TRUNCATE TABLE $likes" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				$wpdb->query( "UPDATE $tracks SET likes = 0" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			}
		}
		if ( 'plays' === $what || 'all' === $what ) {
			if ( $track_id ) {
				$wpdb->update( $tracks, array( 'plays' => 0 ), array( 'id' => (int) $track_id ), array( '%d' ), array( '%d' ) );
			} else {
				$wpdb->query( "UPDATE $tracks SET plays = 0" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			}
		}
	}

	/** Remove tracks whose MP3 was deleted from the media library. */
	public static function on_attachment_deleted( $attachment_id ) {
		global $wpdb;
		$table = self::tracks_table();
		$ids   = $wpdb->get_col( $wpdb->prepare( "SELECT id FROM $table WHERE attachment_id = %d", $attachment_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		foreach ( $ids as $id ) {
			self::delete_track( (int) $id );
		}
	}
}

add_action( 'delete_attachment', array( 'Federhall_DB', 'on_attachment_deleted' ) );
