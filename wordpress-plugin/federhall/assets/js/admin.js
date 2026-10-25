/* Federhall admin: media picker, drag & drop upload, sortable track list. */
jQuery( function ( $ ) {
	'use strict';
	var cfg = window.federhallAdmin || {}, t = cfg.i18n || {};

	// pick or upload MP3s through the media library
	var frame;
	$( '#federhall-add' ).on( 'click', function ( e ) {
		e.preventDefault();
		if ( ! frame ) {
			frame = wp.media( {
				title: t.frameTitle,
				button: { text: t.frameButton },
				library: { type: 'audio' },
				multiple: 'add'
			} );
			frame.on( 'select', function () {
				var ids = frame.state().get( 'selection' ).map( function ( a ) { return a.id; } );
				if ( ! ids.length ) return;
				$( '#federhall-add' ).prop( 'disabled', true ).text( t.adding );
				$.post( cfg.ajaxUrl, { action: 'federhall_add_tracks', _ajax_nonce: cfg.nonce, ids: ids } )
					.done( function ( res ) {
						if ( res && res.success ) window.location.href = res.data.redirect;
						else window.alert( t.error );
					} )
					.fail( function () { window.alert( t.error ); } );
			} );
		}
		frame.open();
	} );

	// drop zone
	var $drop = $( '.fh-drop' ), $input = $( '#federhall-files' ), $btn = $( '#federhall-upload-btn' ), $list = $( '#federhall-file-list' );
	function showFiles() {
		var files = $input[ 0 ] && $input[ 0 ].files ? Array.prototype.slice.call( $input[ 0 ].files ) : [];
		$btn.prop( 'disabled', ! files.length );
		$list.text( files.map( function ( f ) { return f.name; } ).join( ', ' ) );
	}
	$input.on( 'change', showFiles );
	$drop.on( 'dragenter dragover', function ( e ) { e.preventDefault(); $drop.addClass( 'is-over' ); } );
	$drop.on( 'dragleave drop', function () { $drop.removeClass( 'is-over' ); } );
	$drop.on( 'drop', function ( e ) {
		e.preventDefault();
		var dt = e.originalEvent.dataTransfer;
		if ( dt && dt.files && dt.files.length ) {
			$input[ 0 ].files = dt.files;
			showFiles();
		}
	} );
	$( '#federhall-upload-form' ).on( 'submit', function () { $btn.prop( 'disabled', true ).addClass( 'updating-message' ); } );

	// sortable rows
	var dirty = false;
	$( '#federhall-sortable' ).sortable( {
		handle: '.fh-handle',
		axis: 'y',
		helper: function ( e, tr ) {
			var $o = tr.children(), $h = tr.clone();
			$h.children().each( function ( i ) { $( this ).width( $o.eq( i ).width() ); } );
			return $h;
		},
		update: function () { dirty = true; }
	} );
	$( '#federhall-tracks-form' ).on( 'change input', function () { dirty = true; } )
		.on( 'submit', function () { dirty = false; } );
	$( window ).on( 'beforeunload', function () { if ( dirty ) return t.unsaved; } );

	$( '.fh-delete' ).on( 'click', function ( e ) {
		if ( ! window.confirm( t.confirmDel ) ) e.preventDefault();
		else dirty = false;
	} );

	// only one preview plays at a time
	$( '.fh-tracks audio' ).on( 'play', function () {
		var me = this;
		$( '.fh-tracks audio' ).each( function () { if ( this !== me ) this.pause(); } );
	} );
} );
