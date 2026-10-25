/* Federhall Player block (editor side). Rendered on the server via [federhall]. */
( function ( wp ) {
	'use strict';
	var el = wp.element.createElement;
	var __ = wp.i18n.__;
	var be = wp.blockEditor;
	var c = wp.components;
	var data = window.federhallEditor || { tracks: [], preview: '', adminUrl: '' };

	wp.blocks.registerBlockType( 'federhall/player', {
		edit: function ( props ) {
			var a = props.attributes;
			var chosen = a.tracks ? a.tracks.split( ',' ).map( Number ).filter( Boolean ) : [];
			var toggle = function ( id, on ) {
				var next = chosen.filter( function ( x ) { return x !== id; } );
				if ( on ) next.push( id );
				props.setAttributes( { tracks: next.join( ',' ) } );
			};
			var startOptions = [ { value: '', label: __( 'Erster Titel', 'federhall' ) } ].concat(
				data.tracks.map( function ( t ) { return { value: String( t.id ), label: t.title }; } )
			);

			return el( 'div', be.useBlockProps(),
				el( be.InspectorControls, null,
					el( c.PanelBody, { title: __( 'Titel', 'federhall' ), initialOpen: true },
						el( 'p', { className: 'components-base-control__help' },
							__( 'Keiner angehakt = alle aktiven Titel.', 'federhall' ) ),
						data.tracks.length ? data.tracks.map( function ( t ) {
							return el( c.CheckboxControl, {
								key: t.id,
								label: t.title + ( t.artist ? ' – ' + t.artist : '' ),
								checked: chosen.indexOf( t.id ) !== -1,
								onChange: function ( on ) { toggle( t.id, on ); }
							} );
						} ) : el( 'p', null, __( 'Noch keine Titel hochgeladen.', 'federhall' ) ),
						el( c.SelectControl, {
							label: __( 'Starttitel', 'federhall' ),
							value: a.track,
							options: startOptions,
							onChange: function ( v ) { props.setAttributes( { track: v } ); }
						} )
					),
					el( c.PanelBody, { title: __( 'Darstellung', 'federhall' ), initialOpen: false },
						el( c.RangeControl, {
							label: __( 'Maximale Breite (px, 0 = Standard)', 'federhall' ),
							value: a.width, min: 0, max: 2000, step: 10,
							onChange: function ( v ) { props.setAttributes( { width: v || 0 } ); }
						} )
					)
				),
				el( 'div', { className: 'federhall-block-preview' },
					data.preview ? el( 'img', { src: data.preview, alt: '', style: { width: '100%', display: 'block', borderRadius: '8px 8px 0 0' } } ) : null,
					el( 'div', { style: { background: '#141a14', color: '#eadcb8', padding: '10px 14px', borderRadius: '0 0 8px 8px', fontSize: '14px' } },
						el( 'strong', null, 'Federhall Player' ),
						' · ',
						chosen.length
							? chosen.length + ' ' + __( 'Titel ausgewählt', 'federhall' )
							: data.tracks.length + ' ' + __( 'Titel (alle aktiven)', 'federhall' ),
						data.adminUrl ? el( 'a', { href: data.adminUrl, target: '_blank', style: { color: '#e8a33a', marginLeft: '10px' } }, __( 'Titel verwalten', 'federhall' ) ) : null
					)
				)
			);
		},
		save: function () { return null; }
	} );
} )( window.wp );
