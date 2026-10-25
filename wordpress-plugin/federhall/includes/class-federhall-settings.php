<?php
/**
 * Plugin settings: default sound and player options.
 *
 * @package Federhall
 */

defined( 'ABSPATH' ) || exit;

class Federhall_Settings {

	const OPTION = 'federhall_settings';

	/** Knob ranges, mirroring the JUCE plugin's parameter layout. */
	public static function knobs() {
		return array(
			'input'    => array( 'label' => 'Input', 'min' => -60, 'max' => 12, 'step' => 0.5, 'unit' => 'dB', 'default' => 0 ),
			'predelay' => array( 'label' => 'Pre-Delay', 'min' => 0, 'max' => 500, 'step' => 1, 'unit' => 'ms', 'default' => 20 ),
			'reverb'   => array( 'label' => 'Reverb', 'min' => 0, 'max' => 100, 'step' => 1, 'unit' => '%', 'default' => 50 ),
			'dwell'    => array( 'label' => 'Dwell', 'min' => 0, 'max' => 100, 'step' => 1, 'unit' => '%', 'default' => 45 ),
			'tone'     => array( 'label' => 'Tone', 'min' => 0, 'max' => 100, 'step' => 1, 'unit' => '%', 'default' => 50 ),
			'mix'      => array( 'label' => 'Mix', 'min' => 0, 'max' => 100, 'step' => 1, 'unit' => '%', 'default' => 30 ),
			'output'   => array( 'label' => 'Output', 'min' => -60, 'max' => 12, 'step' => 0.5, 'unit' => 'dB', 'default' => 0 ),
		);
	}

	public static function switches() {
		return array(
			'mode'  => array( 'label' => 'Spring Mode', 'choices' => array( 'Spring', 'Plate' ), 'default' => 0 ),
			'eq'    => array( 'label' => 'EQ', 'choices' => array( 'Flat', 'Dub' ), 'default' => 1 ),
			'drive' => array( 'label' => 'Tank Drive', 'choices' => array( 'Clean', 'Dirty' ), 'default' => 0 ),
		);
	}

	public static function defaults() {
		$d = array();
		foreach ( self::knobs() as $k => $def ) {
			$d[ $k ] = $def['default'];
		}
		foreach ( self::switches() as $k => $def ) {
			$d[ $k ] = $def['default'];
		}
		return array_merge(
			$d,
			array(
				'likes'           => 1,
				'show_like_count' => 1,
				'like_mode'       => 'browser', // browser | ip
				'show_plays'      => 0,
				'record'          => 1,
				'auto_next'       => 1,
				'loop'            => 'none', // none | all | track
				'max_width'       => 1100,
				'hint'            => __( 'Tipp: Fahr mit der Maus schnell über die Federn oder streich mit dem Finger drüber, dann krachen sie wie bei King Tubby. Doppelklick auf einen Regler setzt ihn zurück.', 'federhall' ),
				'delete_data'     => 0,
			)
		);
	}

	public static function get() {
		$saved = get_option( self::OPTION, array() );
		return wp_parse_args( is_array( $saved ) ? $saved : array(), self::defaults() );
	}

	public static function sanitize( $in ) {
		$in  = is_array( $in ) ? $in : array();
		$out = self::defaults();
		foreach ( self::knobs() as $k => $def ) {
			if ( isset( $in[ $k ] ) && is_numeric( $in[ $k ] ) ) {
				$out[ $k ] = max( $def['min'], min( $def['max'], (float) $in[ $k ] ) );
			}
		}
		foreach ( array_keys( self::switches() ) as $k ) {
			$out[ $k ] = empty( $in[ $k ] ) ? 0 : 1;
		}
		foreach ( array( 'likes', 'show_like_count', 'show_plays', 'record', 'auto_next', 'delete_data' ) as $k ) {
			$out[ $k ] = empty( $in[ $k ] ) ? 0 : 1;
		}
		$out['like_mode'] = isset( $in['like_mode'] ) && 'ip' === $in['like_mode'] ? 'ip' : 'browser';
		$out['loop']      = isset( $in['loop'] ) && in_array( $in['loop'], array( 'none', 'all', 'track' ), true ) ? $in['loop'] : 'none';
		$out['max_width'] = isset( $in['max_width'] ) ? max( 320, min( 2400, absint( $in['max_width'] ) ) ) : 1100;
		$out['hint']      = isset( $in['hint'] ) ? sanitize_textarea_field( $in['hint'] ) : '';
		return $out;
	}

	/** Sound defaults in engine units (percent knobs become 0..1). */
	public static function engine_defaults( $s = null ) {
		$s   = $s ? $s : self::get();
		$out = array();
		foreach ( self::knobs() as $k => $def ) {
			$v         = (float) $s[ $k ];
			$out[ $k ] = '%' === $def['unit'] ? $v / 100 : $v;
		}
		foreach ( array_keys( self::switches() ) as $k ) {
			$out[ $k ] = (int) $s[ $k ];
		}
		return $out;
	}
}
