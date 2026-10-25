<?php
/**
 * Admin menu "Federhall Plugin": tracks, statistics, settings, help.
 *
 * @package Federhall
 */

defined( 'ABSPATH' ) || exit;

class Federhall_Admin {

	const CAP = 'upload_files';

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_init', array( __CLASS__, 'register_settings' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'assets' ) );
		add_action( 'admin_post_federhall_save_tracks', array( __CLASS__, 'save_tracks' ) );
		add_action( 'admin_post_federhall_upload', array( __CLASS__, 'upload' ) );
		add_action( 'admin_post_federhall_delete_track', array( __CLASS__, 'delete_track' ) );
		add_action( 'admin_post_federhall_reset_stats', array( __CLASS__, 'reset_stats' ) );
		add_action( 'admin_post_federhall_export', array( __CLASS__, 'export_csv' ) );
		add_action( 'wp_ajax_federhall_add_tracks', array( __CLASS__, 'ajax_add_tracks' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( FEDERHALL_FILE ), array( __CLASS__, 'action_links' ) );
	}

	public static function menu() {
		add_menu_page(
			__( 'Federhall Plugin', 'federhall' ),
			__( 'Federhall Plugin', 'federhall' ),
			self::CAP,
			'federhall',
			array( __CLASS__, 'page_tracks' ),
			'dashicons-format-audio',
			26
		);
		add_submenu_page( 'federhall', __( 'Titel & MP3-Upload', 'federhall' ), __( 'Titel & Upload', 'federhall' ), self::CAP, 'federhall', array( __CLASS__, 'page_tracks' ) );
		add_submenu_page( 'federhall', __( 'Statistik & Likes', 'federhall' ), __( 'Statistik & Likes', 'federhall' ), self::CAP, 'federhall-stats', array( __CLASS__, 'page_stats' ) );
		add_submenu_page( 'federhall', __( 'Einstellungen', 'federhall' ), __( 'Einstellungen', 'federhall' ), 'manage_options', 'federhall-settings', array( __CLASS__, 'page_settings' ) );
		add_submenu_page( 'federhall', __( 'Anleitung', 'federhall' ), __( 'Anleitung & Shortcode', 'federhall' ), self::CAP, 'federhall-help', array( __CLASS__, 'page_help' ) );
	}

	public static function action_links( $links ) {
		array_unshift(
			$links,
			'<a href="' . esc_url( admin_url( 'admin.php?page=federhall' ) ) . '">' . esc_html__( 'Titel', 'federhall' ) . '</a>',
			'<a href="' . esc_url( admin_url( 'admin.php?page=federhall-settings' ) ) . '">' . esc_html__( 'Einstellungen', 'federhall' ) . '</a>'
		);
		return $links;
	}

	public static function register_settings() {
		register_setting(
			'federhall',
			Federhall_Settings::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( 'Federhall_Settings', 'sanitize' ),
				'default'           => Federhall_Settings::defaults(),
			)
		);
	}

	public static function assets( $hook ) {
		if ( false === strpos( (string) $hook, 'federhall' ) ) {
			return;
		}
		wp_enqueue_style( 'federhall-admin', FEDERHALL_URL . 'assets/css/admin.css', array(), FEDERHALL_VERSION );
		if ( 'toplevel_page_federhall' === $hook ) {
			wp_enqueue_media();
			wp_enqueue_script( 'federhall-admin', FEDERHALL_URL . 'assets/js/admin.js', array( 'jquery', 'jquery-ui-sortable' ), FEDERHALL_VERSION, true );
			wp_localize_script(
				'federhall-admin',
				'federhallAdmin',
				array(
					'ajaxUrl' => admin_url( 'admin-ajax.php' ),
					'nonce'   => wp_create_nonce( 'federhall_add_tracks' ),
					'i18n'    => array(
						'frameTitle'  => __( 'MP3-Dateien für den Federhall wählen oder hochladen', 'federhall' ),
						'frameButton' => __( 'Zum Federhall hinzufügen', 'federhall' ),
						'adding'      => __( 'Titel werden hinzugefügt …', 'federhall' ),
						'error'       => __( 'Das hat nicht geklappt. Bitte Seite neu laden und nochmal versuchen.', 'federhall' ),
						'confirmDel'  => __( 'Diesen Titel aus dem Federhall entfernen? Die MP3 bleibt in der Mediathek, die Likes des Titels werden gelöscht.', 'federhall' ),
						'unsaved'     => __( 'Es gibt ungespeicherte Änderungen.', 'federhall' ),
					),
				)
			);
		}
	}

	private static function notice() {
		if ( empty( $_GET['fh_msg'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			return;
		}
		$msg  = sanitize_key( wp_unslash( $_GET['fh_msg'] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$n    = isset( $_GET['fh_n'] ) ? absint( $_GET['fh_n'] ) : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$type = 'success';
		switch ( $msg ) {
			case 'saved':
				$text = __( 'Änderungen gespeichert.', 'federhall' );
				break;
			case 'added':
				/* translators: %d: number of tracks */
				$text = sprintf( _n( '%d Titel hinzugefügt.', '%d Titel hinzugefügt.', $n, 'federhall' ), $n );
				break;
			case 'deleted':
				$text = __( 'Titel entfernt.', 'federhall' );
				break;
			case 'reset':
				$text = __( 'Statistik zurückgesetzt.', 'federhall' );
				break;
			case 'uploaderr':
				$type = 'error';
				$text = isset( $_GET['fh_err'] ) ? sanitize_text_field( wp_unslash( $_GET['fh_err'] ) ) : __( 'Upload fehlgeschlagen.', 'federhall' ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
				break;
			default:
				return;
		}
		printf( '<div class="notice notice-%s is-dismissible"><p>%s</p></div>', esc_attr( $type ), esc_html( $text ) );
	}

	private static function redirect( $page, $args = array() ) {
		wp_safe_redirect( add_query_arg( $args, admin_url( 'admin.php?page=' . $page ) ) );
		exit;
	}

	// ------------------------------------------------------------------ tracks page

	public static function page_tracks() {
		$tracks = Federhall_DB::get_tracks();
		?>
		<div class="wrap federhall-admin">
			<h1 class="wp-heading-inline"><?php esc_html_e( 'Federhall Plugin – Titel', 'federhall' ); ?></h1>
			<button type="button" class="page-title-action" id="federhall-add"><?php esc_html_e( 'MP3s hinzufügen', 'federhall' ); ?></button>
			<hr class="wp-header-end">
			<?php self::notice(); ?>

			<div class="fh-card fh-upload">
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" enctype="multipart/form-data" id="federhall-upload-form">
					<?php wp_nonce_field( 'federhall_upload' ); ?>
					<input type="hidden" name="action" value="federhall_upload">
					<label class="fh-drop" for="federhall-files">
						<span class="dashicons dashicons-upload"></span>
						<strong><?php esc_html_e( 'MP3-Dateien hierher ziehen oder klicken', 'federhall' ); ?></strong>
						<span class="description">
							<?php
							/* translators: %s: max upload size */
							printf( esc_html__( 'Mehrere Dateien auf einmal möglich. Maximale Größe pro Datei: %s. Titel und Interpret werden aus den MP3-Tags übernommen.', 'federhall' ), esc_html( size_format( wp_max_upload_size() ) ) );
							?>
						</span>
						<input type="file" id="federhall-files" name="federhall_mp3[]" accept=".mp3,audio/mpeg" multiple>
					</label>
					<p class="fh-upload-actions">
						<button type="submit" class="button button-primary" id="federhall-upload-btn" disabled><?php esc_html_e( 'Hochladen', 'federhall' ); ?></button>
						<span class="fh-file-list" id="federhall-file-list"></span>
						<span class="description"><?php esc_html_e( 'Oder oben „MP3s hinzufügen“ für Dateien, die schon in der Mediathek liegen.', 'federhall' ); ?></span>
					</p>
				</form>
			</div>

			<?php if ( ! $tracks ) : ?>
				<div class="fh-card fh-empty">
					<p><?php esc_html_e( 'Noch keine Titel. Lade ein paar MP3s hoch, dann erscheinen sie im Dropdown des Players.', 'federhall' ); ?></p>
				</div>
			<?php else : ?>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" id="federhall-tracks-form">
					<?php wp_nonce_field( 'federhall_save_tracks' ); ?>
					<input type="hidden" name="action" value="federhall_save_tracks">
					<table class="widefat striped fh-tracks">
						<thead>
							<tr>
								<th class="fh-col-handle" aria-label="<?php esc_attr_e( 'Reihenfolge', 'federhall' ); ?>"></th>
								<th class="fh-col-title"><?php esc_html_e( 'Titel', 'federhall' ); ?></th>
								<th class="fh-col-artist"><?php esc_html_e( 'Interpret', 'federhall' ); ?></th>
								<th><?php esc_html_e( 'Kurzbeschreibung', 'federhall' ); ?></th>
								<th class="fh-col-audio"><?php esc_html_e( 'Vorhören', 'federhall' ); ?></th>
								<th class="fh-col-num"><span class="dashicons dashicons-heart" aria-hidden="true"></span> <?php esc_html_e( 'Likes', 'federhall' ); ?></th>
								<th class="fh-col-num"><?php esc_html_e( 'Plays', 'federhall' ); ?></th>
								<th class="fh-col-num"><?php esc_html_e( 'Aktiv', 'federhall' ); ?></th>
								<th class="fh-col-num">ID</th>
								<th class="fh-col-del"></th>
							</tr>
						</thead>
						<tbody id="federhall-sortable">
							<?php foreach ( $tracks as $t ) : ?>
								<?php
								$url = wp_get_attachment_url( (int) $t->attachment_id );
								$id  = (int) $t->id;
								?>
								<tr>
									<td class="fh-col-handle"><span class="dashicons dashicons-menu fh-handle" title="<?php esc_attr_e( 'Ziehen zum Sortieren', 'federhall' ); ?>"></span><input type="hidden" name="order[]" value="<?php echo esc_attr( $id ); ?>"></td>
									<td><input type="text" class="regular-text" name="t[<?php echo esc_attr( $id ); ?>][title]" value="<?php echo esc_attr( $t->title ); ?>" required></td>
									<td><input type="text" name="t[<?php echo esc_attr( $id ); ?>][artist]" value="<?php echo esc_attr( $t->artist ); ?>"></td>
									<td><input type="text" name="t[<?php echo esc_attr( $id ); ?>][description]" value="<?php echo esc_attr( (string) $t->description ); ?>" placeholder="<?php esc_attr_e( 'optional, steht unter dem Player', 'federhall' ); ?>"></td>
									<td class="fh-col-audio">
										<?php if ( $url ) : ?>
											<audio controls preload="none" src="<?php echo esc_url( $url ); ?>"></audio>
										<?php else : ?>
											<span class="fh-missing"><?php esc_html_e( 'Datei fehlt', 'federhall' ); ?></span>
										<?php endif; ?>
									</td>
									<td class="fh-col-num"><strong><?php echo esc_html( number_format_i18n( $t->likes ) ); ?></strong></td>
									<td class="fh-col-num"><?php echo esc_html( number_format_i18n( $t->plays ) ); ?></td>
									<td class="fh-col-num"><input type="checkbox" name="t[<?php echo esc_attr( $id ); ?>][active]" value="1" <?php checked( (int) $t->active, 1 ); ?> aria-label="<?php esc_attr_e( 'Im Player anzeigen', 'federhall' ); ?>"></td>
									<td class="fh-col-num"><code><?php echo esc_html( $id ); ?></code></td>
									<td>
										<a class="fh-delete" href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=federhall_delete_track&track=' . $id ), 'federhall_delete_' . $id ) ); ?>" title="<?php esc_attr_e( 'Entfernen', 'federhall' ); ?>"><span class="dashicons dashicons-trash"></span><span class="screen-reader-text"><?php esc_html_e( 'Entfernen', 'federhall' ); ?></span></a>
									</td>
								</tr>
							<?php endforeach; ?>
						</tbody>
					</table>
					<p class="fh-save-row">
						<button type="submit" class="button button-primary"><?php esc_html_e( 'Änderungen speichern', 'federhall' ); ?></button>
						<span class="description"><?php esc_html_e( 'Reihenfolge per Drag & Drop am Griff links. Die Reihenfolge gilt auch im Dropdown.', 'federhall' ); ?></span>
					</p>
				</form>
			<?php endif; ?>
		</div>
		<?php
	}

	public static function save_tracks() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( esc_html__( 'Keine Berechtigung.', 'federhall' ), 403 );
		}
		check_admin_referer( 'federhall_save_tracks' );
		$rows  = isset( $_POST['t'] ) && is_array( $_POST['t'] ) ? wp_unslash( $_POST['t'] ) : array(); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- sanitized per field below.
		$order = isset( $_POST['order'] ) ? array_map( 'absint', (array) wp_unslash( $_POST['order'] ) ) : array();
		$pos   = array_flip( $order );
		foreach ( $rows as $id => $row ) {
			$id = absint( $id );
			if ( ! $id || ! is_array( $row ) ) {
				continue;
			}
			$data = array(
				'title'       => sanitize_text_field( isset( $row['title'] ) ? $row['title'] : '' ),
				'artist'      => sanitize_text_field( isset( $row['artist'] ) ? $row['artist'] : '' ),
				'description' => sanitize_text_field( isset( $row['description'] ) ? $row['description'] : '' ),
				'active'      => empty( $row['active'] ) ? 0 : 1,
			);
			if ( '' === $data['title'] ) {
				unset( $data['title'] );
			}
			if ( isset( $pos[ $id ] ) ) {
				$data['sort_order'] = $pos[ $id ] + 1;
			}
			Federhall_DB::update_track( $id, $data );
		}
		self::redirect( 'federhall', array( 'fh_msg' => 'saved' ) );
	}

	public static function upload() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( esc_html__( 'Keine Berechtigung.', 'federhall' ), 403 );
		}
		check_admin_referer( 'federhall_upload' );
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		$added  = 0;
		$errors = array();
		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized,WordPress.Security.ValidatedSanitizedInput.MissingUnslash -- handled by media_handle_upload.
		$files = isset( $_FILES['federhall_mp3'] ) ? $_FILES['federhall_mp3'] : null;
		if ( $files && is_array( $files['name'] ) ) {
			$count = count( $files['name'] );
			for ( $i = 0; $i < $count; $i++ ) {
				if ( UPLOAD_ERR_NO_FILE === (int) $files['error'][ $i ] ) {
					continue;
				}
				$name = sanitize_file_name( $files['name'][ $i ] );
				$type = wp_check_filetype( $name );
				if ( 'mp3' !== strtolower( (string) $type['ext'] ) ) {
					/* translators: %s: file name */
					$errors[] = sprintf( __( '%s ist keine MP3-Datei.', 'federhall' ), $name );
					continue;
				}
				$_FILES['federhall_single'] = array(
					'name'     => $files['name'][ $i ],
					'type'     => $files['type'][ $i ],
					'tmp_name' => $files['tmp_name'][ $i ],
					'error'    => $files['error'][ $i ],
					'size'     => $files['size'][ $i ],
				);
				$att = media_handle_upload( 'federhall_single', 0, array(), array( 'test_form' => false ) );
				if ( is_wp_error( $att ) ) {
					$errors[] = $name . ': ' . $att->get_error_message();
					continue;
				}
				Federhall_DB::add_track( (int) $att );
				++$added;
			}
		}
		if ( $errors ) {
			self::redirect( 'federhall', array( 'fh_msg' => 'uploaderr', 'fh_err' => rawurlencode( implode( ' | ', $errors ) ) ) );
		}
		self::redirect( 'federhall', array( 'fh_msg' => 'added', 'fh_n' => $added ) );
	}

	public static function ajax_add_tracks() {
		check_ajax_referer( 'federhall_add_tracks' );
		if ( ! current_user_can( self::CAP ) ) {
			wp_send_json_error( null, 403 );
		}
		$ids   = isset( $_POST['ids'] ) ? array_map( 'absint', (array) wp_unslash( $_POST['ids'] ) ) : array();
		$added = 0;
		foreach ( array_filter( $ids ) as $id ) {
			$mime = get_post_mime_type( $id );
			if ( ! $mime || 0 !== strpos( $mime, 'audio/' ) || Federhall_DB::track_exists_for_attachment( $id ) ) {
				continue;
			}
			Federhall_DB::add_track( $id );
			++$added;
		}
		wp_send_json_success(
			array(
				'added'    => $added,
				'redirect' => add_query_arg( array( 'fh_msg' => 'added', 'fh_n' => $added ), admin_url( 'admin.php?page=federhall' ) ),
			)
		);
	}

	public static function delete_track() {
		$id = isset( $_GET['track'] ) ? absint( $_GET['track'] ) : 0;
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( esc_html__( 'Keine Berechtigung.', 'federhall' ), 403 );
		}
		check_admin_referer( 'federhall_delete_' . $id );
		Federhall_DB::delete_track( $id );
		self::redirect( 'federhall', array( 'fh_msg' => 'deleted' ) );
	}

	// ------------------------------------------------------------------ stats page

	public static function page_stats() {
		$tracks      = Federhall_DB::get_tracks( array( 'orderby' => 'likes' ) );
		$total_likes = 0;
		$total_plays = 0;
		foreach ( $tracks as $t ) {
			$total_likes += (int) $t->likes;
			$total_plays += (int) $t->plays;
		}
		$max_likes = $tracks ? max( 1, (int) $tracks[0]->likes ) : 1;
		$per_day   = Federhall_DB::likes_per_day( 30 );
		$max_day   = max( 1, max( $per_day ) );
		$last30    = array_sum( $per_day );
		$top       = $tracks && $tracks[0]->likes > 0 ? $tracks[0] : null;
		?>
		<div class="wrap federhall-admin">
			<h1><?php esc_html_e( 'Federhall Plugin – Statistik & Likes', 'federhall' ); ?></h1>
			<?php self::notice(); ?>

			<div class="fh-tiles">
				<div class="fh-tile"><span class="fh-tile-label"><?php esc_html_e( 'Likes gesamt', 'federhall' ); ?></span><span class="fh-tile-value"><?php echo esc_html( number_format_i18n( $total_likes ) ); ?></span></div>
				<div class="fh-tile"><span class="fh-tile-label"><?php esc_html_e( 'Likes letzte 30 Tage', 'federhall' ); ?></span><span class="fh-tile-value"><?php echo esc_html( number_format_i18n( $last30 ) ); ?></span></div>
				<div class="fh-tile"><span class="fh-tile-label"><?php esc_html_e( 'Plays gesamt', 'federhall' ); ?></span><span class="fh-tile-value"><?php echo esc_html( number_format_i18n( $total_plays ) ); ?></span></div>
				<div class="fh-tile fh-tile-top"><span class="fh-tile-label"><?php esc_html_e( 'Beliebtester Titel', 'federhall' ); ?></span><span class="fh-tile-value fh-tile-text"><?php echo $top ? esc_html( $top->title ) : '–'; ?></span></div>
			</div>

			<div class="fh-card">
				<h2><?php esc_html_e( 'Ranking nach Likes', 'federhall' ); ?></h2>
				<?php if ( ! $tracks ) : ?>
					<p><?php esc_html_e( 'Noch keine Titel vorhanden.', 'federhall' ); ?></p>
				<?php else : ?>
					<table class="widefat striped fh-ranking">
						<thead>
							<tr>
								<th class="fh-col-num">#</th>
								<th><?php esc_html_e( 'Titel', 'federhall' ); ?></th>
								<th class="fh-col-bar"><?php esc_html_e( 'Likes', 'federhall' ); ?></th>
								<th class="fh-col-num"><?php esc_html_e( 'Plays', 'federhall' ); ?></th>
								<th class="fh-col-num" title="<?php esc_attr_e( 'Likes pro Play: wie viele Hörer den Titel geliked haben', 'federhall' ); ?>"><?php esc_html_e( 'Like-Quote', 'federhall' ); ?></th>
								<th class="fh-col-num"><?php esc_html_e( 'Status', 'federhall' ); ?></th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							<?php foreach ( $tracks as $i => $t ) : ?>
								<?php
								$pct   = round( 100 * (int) $t->likes / $max_likes );
								$ratio = $t->plays > 0 ? round( 100 * $t->likes / $t->plays ) . ' %' : '–';
								?>
								<tr>
									<td class="fh-col-num"><strong><?php echo esc_html( $i + 1 ); ?></strong></td>
									<td><strong><?php echo esc_html( $t->title ); ?></strong><?php echo $t->artist ? '<br><span class="description">' . esc_html( $t->artist ) . '</span>' : ''; ?></td>
									<td class="fh-col-bar">
										<div class="fh-bar-row" title="<?php echo esc_attr( $t->title . ': ' . $t->likes . ' Likes' ); ?>">
											<span class="fh-hbar" style="width: <?php echo esc_attr( max( $t->likes ? 2 : 0, $pct ) ); ?>%"></span>
											<span class="fh-hbar-val"><?php echo esc_html( number_format_i18n( $t->likes ) ); ?></span>
										</div>
									</td>
									<td class="fh-col-num"><?php echo esc_html( number_format_i18n( $t->plays ) ); ?></td>
									<td class="fh-col-num"><?php echo esc_html( $ratio ); ?></td>
									<td class="fh-col-num"><?php echo $t->active ? esc_html__( 'aktiv', 'federhall' ) : '<span class="description">' . esc_html__( 'versteckt', 'federhall' ) . '</span>'; ?></td>
									<td>
										<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" onsubmit="return confirm('<?php echo esc_js( __( 'Likes und Plays dieses Titels auf 0 setzen?', 'federhall' ) ); ?>');">
											<?php wp_nonce_field( 'federhall_reset_stats' ); ?>
											<input type="hidden" name="action" value="federhall_reset_stats">
											<input type="hidden" name="track" value="<?php echo esc_attr( $t->id ); ?>">
											<input type="hidden" name="what" value="all">
											<button type="submit" class="button-link fh-reset-link"><?php esc_html_e( 'Zurücksetzen', 'federhall' ); ?></button>
										</form>
									</td>
								</tr>
							<?php endforeach; ?>
						</tbody>
					</table>
				<?php endif; ?>
			</div>

			<div class="fh-card">
				<h2><?php esc_html_e( 'Likes pro Tag (letzte 30 Tage)', 'federhall' ); ?></h2>
				<div class="fh-chart" role="img" aria-label="<?php echo esc_attr( sprintf( /* translators: %d: likes */ __( '%d Likes in den letzten 30 Tagen', 'federhall' ), $last30 ) ); ?>">
					<div class="fh-chart-axis"><span><?php echo esc_html( $max_day ); ?></span><span>0</span></div>
					<div class="fh-chart-bars">
						<?php foreach ( $per_day as $day => $c ) : ?>
							<?php $label = date_i18n( 'D, j. M', strtotime( $day . ' 12:00:00' ) ) . ': ' . $c . ' ' . _n( 'Like', 'Likes', $c, 'federhall' ); ?>
							<div class="fh-vbar-wrap" title="<?php echo esc_attr( $label ); ?>" tabindex="0" aria-label="<?php echo esc_attr( $label ); ?>">
								<span class="fh-vbar" style="height: <?php echo esc_attr( $c ? max( 2, round( 100 * $c / $max_day ) ) : 0 ); ?>%"></span>
							</div>
						<?php endforeach; ?>
					</div>
				</div>
				<div class="fh-chart-x"><span><?php echo esc_html( date_i18n( 'j. M', strtotime( array_key_first( $per_day ) . ' 12:00:00' ) ) ); ?></span><span><?php esc_html_e( 'heute', 'federhall' ); ?></span></div>
			</div>

			<div class="fh-card fh-actions">
				<h2><?php esc_html_e( 'Export & Zurücksetzen', 'federhall' ); ?></h2>
				<p>
					<a class="button" href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=federhall_export' ), 'federhall_export' ) ); ?>"><?php esc_html_e( 'Als CSV herunterladen (Excel)', 'federhall' ); ?></a>
				</p>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" onsubmit="return confirm('<?php echo esc_js( __( 'Wirklich alle Werte löschen? Das lässt sich nicht rückgängig machen.', 'federhall' ) ); ?>');">
					<?php wp_nonce_field( 'federhall_reset_stats' ); ?>
					<input type="hidden" name="action" value="federhall_reset_stats">
					<input type="hidden" name="track" value="0">
					<select name="what">
						<option value="likes"><?php esc_html_e( 'Alle Likes löschen', 'federhall' ); ?></option>
						<option value="plays"><?php esc_html_e( 'Alle Plays löschen', 'federhall' ); ?></option>
						<option value="all"><?php esc_html_e( 'Likes und Plays löschen', 'federhall' ); ?></option>
					</select>
					<button type="submit" class="button button-link-delete"><?php esc_html_e( 'Zurücksetzen', 'federhall' ); ?></button>
				</form>
				<p class="description"><?php esc_html_e( 'Datenschutz: Für Likes wird nur ein verschlüsselter Fingerabdruck gespeichert (Zufalls-ID des Browsers bzw. IP-Adresse als Hash), keine Namen und keine IP-Adressen im Klartext.', 'federhall' ); ?></p>
			</div>
		</div>
		<?php
	}

	public static function reset_stats() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( esc_html__( 'Keine Berechtigung.', 'federhall' ), 403 );
		}
		check_admin_referer( 'federhall_reset_stats' );
		$track = isset( $_POST['track'] ) ? absint( $_POST['track'] ) : 0;
		$what  = isset( $_POST['what'] ) ? sanitize_key( wp_unslash( $_POST['what'] ) ) : 'likes';
		if ( ! in_array( $what, array( 'likes', 'plays', 'all' ), true ) ) {
			$what = 'likes';
		}
		Federhall_DB::reset_stats( $track, $what );
		self::redirect( 'federhall-stats', array( 'fh_msg' => 'reset' ) );
	}

	public static function export_csv() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( esc_html__( 'Keine Berechtigung.', 'federhall' ), 403 );
		}
		check_admin_referer( 'federhall_export' );
		nocache_headers();
		header( 'Content-Type: text/csv; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename=federhall-statistik-' . gmdate( 'Y-m-d' ) . '.csv' );
		$out = fopen( 'php://output', 'w' );
		fwrite( $out, "\xEF\xBB\xBF" ); // BOM so Excel reads the umlauts.
		fputcsv( $out, array( 'Rang', 'ID', 'Titel', 'Interpret', 'Likes', 'Plays', 'Like-Quote %', 'Aktiv', 'Datei' ), ';' );
		foreach ( Federhall_DB::get_tracks( array( 'orderby' => 'likes' ) ) as $i => $t ) {
			fputcsv(
				$out,
				array(
					$i + 1,
					$t->id,
					self::csv_safe( $t->title ),
					self::csv_safe( $t->artist ),
					$t->likes,
					$t->plays,
					$t->plays > 0 ? round( 100 * $t->likes / $t->plays ) : '',
					$t->active ? 'ja' : 'nein',
					wp_get_attachment_url( (int) $t->attachment_id ),
				),
				';'
			);
		}
		fclose( $out ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose
		exit;
	}

	/** Keep spreadsheet apps from treating a title as a formula. */
	private static function csv_safe( $s ) {
		return preg_match( '/^[=+\-@\t\r]/', (string) $s ) ? "'" . $s : $s;
	}

	// ------------------------------------------------------------------ settings page

	public static function page_settings() {
		$s   = Federhall_Settings::get();
		$opt = Federhall_Settings::OPTION;
		?>
		<div class="wrap federhall-admin">
			<h1><?php esc_html_e( 'Federhall Plugin – Einstellungen', 'federhall' ); ?></h1>
			<?php settings_errors(); ?>
			<form method="post" action="options.php">
				<?php settings_fields( 'federhall' ); ?>

				<div class="fh-card">
					<h2><?php esc_html_e( 'Grundeinstellung des Sounds', 'federhall' ); ?></h2>
					<p class="description"><?php esc_html_e( 'So stehen die Regler, wenn ein Besucher die Seite öffnet. Der Knopf „Regler zurücksetzen“ im Player springt hierhin zurück.', 'federhall' ); ?></p>
					<div class="fh-knob-grid">
						<?php foreach ( Federhall_Settings::knobs() as $key => $k ) : ?>
							<label class="fh-knob-field">
								<span class="fh-knob-label"><?php echo esc_html( $k['label'] ); ?></span>
								<input type="range" min="<?php echo esc_attr( $k['min'] ); ?>" max="<?php echo esc_attr( $k['max'] ); ?>" step="<?php echo esc_attr( $k['step'] ); ?>" value="<?php echo esc_attr( $s[ $key ] ); ?>" name="<?php echo esc_attr( $opt . '[' . $key . ']' ); ?>" oninput="this.nextElementSibling.firstChild.textContent=this.value">
								<output><span><?php echo esc_html( $s[ $key ] ); ?></span> <?php echo esc_html( $k['unit'] ); ?></output>
							</label>
						<?php endforeach; ?>
					</div>
					<div class="fh-switch-grid">
						<?php foreach ( Federhall_Settings::switches() as $key => $sw ) : ?>
							<fieldset>
								<legend><?php echo esc_html( $sw['label'] ); ?></legend>
								<?php foreach ( $sw['choices'] as $val => $label ) : ?>
									<label><input type="radio" name="<?php echo esc_attr( $opt . '[' . $key . ']' ); ?>" value="<?php echo esc_attr( $val ); ?>" <?php checked( (int) $s[ $key ], $val ); ?>> <?php echo esc_html( $label ); ?></label>
								<?php endforeach; ?>
							</fieldset>
						<?php endforeach; ?>
					</div>
				</div>

				<div class="fh-card">
					<h2><?php esc_html_e( 'Player', 'federhall' ); ?></h2>
					<table class="form-table" role="presentation">
						<tr>
							<th scope="row"><?php esc_html_e( 'Herz-Likes', 'federhall' ); ?></th>
							<td>
								<label><input type="checkbox" name="<?php echo esc_attr( $opt ); ?>[likes]" value="1" <?php checked( $s['likes'], 1 ); ?>> <?php esc_html_e( 'Besucher können Titel mit einem Herz liken', 'federhall' ); ?></label><br>
								<label><input type="checkbox" name="<?php echo esc_attr( $opt ); ?>[show_like_count]" value="1" <?php checked( $s['show_like_count'], 1 ); ?>> <?php esc_html_e( 'Anzahl der Likes öffentlich anzeigen', 'federhall' ); ?></label>
							</td>
						</tr>
						<tr>
							<th scope="row"><?php esc_html_e( 'Schutz gegen Mehrfach-Likes', 'federhall' ); ?></th>
							<td>
								<label><input type="radio" name="<?php echo esc_attr( $opt ); ?>[like_mode]" value="browser" <?php checked( $s['like_mode'], 'browser' ); ?>> <?php esc_html_e( 'Ein Like pro Browser (empfohlen, auch für mehrere Leute im selben WLAN)', 'federhall' ); ?></label><br>
								<label><input type="radio" name="<?php echo esc_attr( $opt ); ?>[like_mode]" value="ip" <?php checked( $s['like_mode'], 'ip' ); ?>> <?php esc_html_e( 'Ein Like pro IP-Adresse (strenger, Leute im selben Netz teilen sich ein Like)', 'federhall' ); ?></label>
							</td>
						</tr>
						<tr>
							<th scope="row"><?php esc_html_e( 'Plays', 'federhall' ); ?></th>
							<td><label><input type="checkbox" name="<?php echo esc_attr( $opt ); ?>[show_plays]" value="1" <?php checked( $s['show_plays'], 1 ); ?>> <?php esc_html_e( 'Wie oft ein Titel gespielt wurde öffentlich anzeigen (gezählt wird immer)', 'federhall' ); ?></label></td>
						</tr>
						<tr>
							<th scope="row"><?php esc_html_e( 'Aufnahme', 'federhall' ); ?></th>
							<td><label><input type="checkbox" name="<?php echo esc_attr( $opt ); ?>[record]" value="1" <?php checked( $s['record'], 1 ); ?>> <?php esc_html_e( 'Aufnahme-Knopf zeigen: Besucher können ihr Experiment mit Effekt als Audiodatei speichern', 'federhall' ); ?></label></td>
						</tr>
						<tr>
							<th scope="row"><?php esc_html_e( 'Wiedergabe', 'federhall' ); ?></th>
							<td>
								<label><input type="checkbox" name="<?php echo esc_attr( $opt ); ?>[auto_next]" value="1" <?php checked( $s['auto_next'], 1 ); ?>> <?php esc_html_e( 'Nach dem Ende automatisch den nächsten Titel spielen', 'federhall' ); ?></label><br>
								<label><?php esc_html_e( 'Wiederholen:', 'federhall' ); ?>
									<select name="<?php echo esc_attr( $opt ); ?>[loop]">
										<option value="none" <?php selected( $s['loop'], 'none' ); ?>><?php esc_html_e( 'Aus', 'federhall' ); ?></option>
										<option value="all" <?php selected( $s['loop'], 'all' ); ?>><?php esc_html_e( 'Alle Titel', 'federhall' ); ?></option>
										<option value="track" <?php selected( $s['loop'], 'track' ); ?>><?php esc_html_e( 'Aktuellen Titel', 'federhall' ); ?></option>
									</select>
								</label>
							</td>
						</tr>
						<tr>
							<th scope="row"><label for="fh-maxw"><?php esc_html_e( 'Maximale Breite', 'federhall' ); ?></label></th>
							<td><input id="fh-maxw" type="number" min="320" max="2400" step="10" class="small-text" name="<?php echo esc_attr( $opt ); ?>[max_width]" value="<?php echo esc_attr( $s['max_width'] ); ?>"> px</td>
						</tr>
						<tr>
							<th scope="row"><label for="fh-hint"><?php esc_html_e( 'Hinweistext unter dem Player', 'federhall' ); ?></label></th>
							<td><textarea id="fh-hint" class="large-text" rows="3" name="<?php echo esc_attr( $opt ); ?>[hint]"><?php echo esc_textarea( $s['hint'] ); ?></textarea>
								<p class="description"><?php esc_html_e( 'Leer lassen, um keinen Hinweis zu zeigen.', 'federhall' ); ?></p></td>
						</tr>
						<tr>
							<th scope="row"><?php esc_html_e( 'Beim Löschen des Plugins', 'federhall' ); ?></th>
							<td><label><input type="checkbox" name="<?php echo esc_attr( $opt ); ?>[delete_data]" value="1" <?php checked( $s['delete_data'], 1 ); ?>> <?php esc_html_e( 'Titelliste, Likes und Einstellungen mitlöschen (die MP3s bleiben in der Mediathek)', 'federhall' ); ?></label></td>
						</tr>
					</table>
				</div>
				<?php submit_button(); ?>
			</form>
		</div>
		<?php
	}

	// ------------------------------------------------------------------ help page

	public static function page_help() {
		?>
		<div class="wrap federhall-admin">
			<h1><?php esc_html_e( 'Federhall Plugin – Anleitung', 'federhall' ); ?></h1>
			<div class="fh-card">
				<h2><?php esc_html_e( 'In 3 Schritten zum Player', 'federhall' ); ?></h2>
				<ol>
					<li><?php printf( wp_kses( /* translators: %s: url */ __( 'Unter <a href="%s">Titel & Upload</a> MP3-Dateien hochladen. Titel und Interpret kommen aus den MP3-Tags und lassen sich ändern.', 'federhall' ), array( 'a' => array( 'href' => array() ) ) ), esc_url( admin_url( 'admin.php?page=federhall' ) ) ); ?></li>
					<li><?php echo wp_kses( __( 'Auf einer Seite oder in einem Beitrag den Block <strong>Federhall Player</strong> einfügen oder den Shortcode <code>[federhall]</code> schreiben.', 'federhall' ), array( 'strong' => array(), 'code' => array() ) ); ?></li>
					<li><?php printf( wp_kses( /* translators: %s: url */ __( 'Unter <a href="%s">Statistik & Likes</a> sehen, welche Titel am besten ankommen.', 'federhall' ), array( 'a' => array( 'href' => array() ) ) ), esc_url( admin_url( 'admin.php?page=federhall-stats' ) ) ); ?></li>
				</ol>
			</div>
			<div class="fh-card">
				<h2><?php esc_html_e( 'Shortcode-Optionen', 'federhall' ); ?></h2>
				<table class="widefat striped">
					<thead><tr><th><?php esc_html_e( 'Beispiel', 'federhall' ); ?></th><th><?php esc_html_e( 'Wirkung', 'federhall' ); ?></th></tr></thead>
					<tbody>
						<tr><td><code>[federhall]</code></td><td><?php esc_html_e( 'Alle aktiven Titel in der festgelegten Reihenfolge.', 'federhall' ); ?></td></tr>
						<tr><td><code>[federhall tracks="3,5,8"]</code></td><td><?php esc_html_e( 'Nur diese Titel (IDs aus der Titelliste), in dieser Reihenfolge.', 'federhall' ); ?></td></tr>
						<tr><td><code>[federhall track="5"]</code></td><td><?php esc_html_e( 'Startet mit Titel 5 im Dropdown.', 'federhall' ); ?></td></tr>
						<tr><td><code>[federhall width="800"]</code></td><td><?php esc_html_e( 'Maximale Breite in Pixel für diesen Player.', 'federhall' ); ?></td></tr>
					</tbody>
				</table>
			</div>
			<div class="fh-card">
				<h2><?php esc_html_e( 'Was Besucher machen können', 'federhall' ); ?></h2>
				<ul class="ul-disc">
					<li><?php esc_html_e( 'Titel im Dropdown wählen, abspielen, vor- und zurückspringen.', 'federhall' ); ?></li>
					<li><?php esc_html_e( 'Alle Regler wie am echten Gerät drehen (ziehen, Mausrad, Pfeiltasten), Doppelklick setzt zurück.', 'federhall' ); ?></li>
					<li><?php esc_html_e( 'Spring/Plate, Flat/Dub und Clean/Dirty an den Kippschaltern umschalten.', 'federhall' ); ?></li>
					<li><?php esc_html_e( 'Die Federn anfassen: antippen zupft, quer drüberstreichen lässt sie krachen, längs entlangfahren kratzt.', 'federhall' ); ?></li>
					<li><?php esc_html_e( 'A/B: Effekt kurz ausschalten, um den Unterschied zu hören.', 'federhall' ); ?></li>
					<li><?php esc_html_e( 'Titel mit dem Herz liken und (falls erlaubt) das Experiment als Audiodatei aufnehmen.', 'federhall' ); ?></li>
				</ul>
			</div>
			<div class="fh-card">
				<h2><?php esc_html_e( 'Gut zu wissen', 'federhall' ); ?></h2>
				<ul class="ul-disc">
					<li><?php esc_html_e( 'Der Hall wird live im Browser des Besuchers berechnet (Web Audio). Das funktioniert in allen aktuellen Browsern auf Computer, Handy und Tablet.', 'federhall' ); ?></li>
					<li><?php esc_html_e( 'Liegen die MP3s auf einem anderen Server (CDN), muss dieser CORS erlauben, sonst bleibt der Effekt stumm.', 'federhall' ); ?></li>
					<li><?php esc_html_e( 'Caching-Plugins sind kein Problem: Likes und Plays werden beim Laden der Seite frisch abgefragt.', 'federhall' ); ?></li>
				</ul>
			</div>
		</div>
		<?php
	}
}
