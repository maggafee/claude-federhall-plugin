<?php
/**
 * Plugin Name:       Federhall – DUBASCO Spring Reverb
 * Plugin URI:        https://github.com/maggafee/claude-federhall-plugin
 * Description:       Der DUBASCO Federhall im Browser: Besucher wählen deine MP3-Titel aus einem Dropdown, schicken sie durch Feder- oder Plattenhall, drehen an den Reglern, lassen die Federn krachen und vergeben Herzen. Einbinden mit [federhall] oder dem Block „Federhall Player“.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Maggafee
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       federhall
 */

defined( 'ABSPATH' ) || exit;

define( 'FEDERHALL_VERSION', '1.0.0' );
define( 'FEDERHALL_DB_VERSION', '1' );
define( 'FEDERHALL_FILE', __FILE__ );
define( 'FEDERHALL_DIR', plugin_dir_path( __FILE__ ) );
define( 'FEDERHALL_URL', plugin_dir_url( __FILE__ ) );

require_once FEDERHALL_DIR . 'includes/class-federhall-db.php';
require_once FEDERHALL_DIR . 'includes/class-federhall-settings.php';
require_once FEDERHALL_DIR . 'includes/class-federhall-rest.php';
require_once FEDERHALL_DIR . 'includes/class-federhall-frontend.php';
if ( is_admin() ) {
	require_once FEDERHALL_DIR . 'includes/class-federhall-admin.php';
}

register_activation_hook( __FILE__, array( 'Federhall_DB', 'install' ) );

add_action(
	'plugins_loaded',
	static function () {
		load_plugin_textdomain( 'federhall', false, dirname( plugin_basename( __FILE__ ) ) . '/languages' );
		Federhall_DB::maybe_upgrade();
		Federhall_REST::init();
		Federhall_Frontend::init();
		if ( is_admin() ) {
			Federhall_Admin::init();
		}
	}
);
