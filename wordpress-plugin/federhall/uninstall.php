<?php
/**
 * Removes the plugin's data on uninstall, but only if the admin asked for it
 * in the settings. MP3 files stay in the media library either way.
 *
 * @package Federhall
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

$federhall_settings = get_option( 'federhall_settings', array() );
if ( empty( $federhall_settings['delete_data'] ) ) {
	return;
}

global $wpdb;
$wpdb->query( "DROP TABLE IF EXISTS {$wpdb->prefix}federhall_likes" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
$wpdb->query( "DROP TABLE IF EXISTS {$wpdb->prefix}federhall_tracks" ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
delete_option( 'federhall_settings' );
delete_option( 'federhall_db_version' );
