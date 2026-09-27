/**
 * STA Accessibility widget. Vanilla JS, no dependencies, works regardless
 * of which theme is active - every effect is applied via CSS classes/
 * inline styles on <html> (see assets/css/a11y-widget.css) rather than
 * relying on any theme's own design tokens, and preferences persist to
 * localStorage so they survive page loads for the same visitor.
 */
( function () {
	'use strict';

	if ( typeof window.staA11y === 'undefined' ) {
		return;
	}

	var config = window.staA11y;
	var STORAGE_KEY = 'sta11y_prefs';

	var DEFAULTS = {
		fontSize: 100,
		lineHeight: 0,
		letterSpacing: 0,
		fontWeight: 0,
		dyslexiaFont: 0,
		contrast: 0,
		saturation: 0,
		invert: 0,
		highContrast: 0,
		tts: false,
	};

	var GRID_CONTROLS = [
		{ key: 'lineHeight', max: 2, label: config.strings.lineHeight, icon: iconLines() },
		{ key: 'letterSpacing', max: 2, label: config.strings.letterSpacing, icon: iconSpacing() },
		{ key: 'fontWeight', max: 2, label: config.strings.fontWeight, icon: iconBold() },
		{ key: 'dyslexiaFont', max: 1, label: config.strings.dyslexiaFont, icon: iconDyslexia() },
		{ key: 'contrast', max: 2, label: config.strings.contrast, icon: iconContrast() },
		{ key: 'saturation', max: 2, label: config.strings.saturation, icon: iconDroplet() },
		{ key: 'invert', max: 1, label: config.strings.invertColors, icon: iconInvert() },
		{ key: 'highContrast', max: 1, label: config.strings.highContrast, icon: iconCircle() },
	];

	var state = loadState();
	var ttsHandler = null;
	var ui = {};

	function loadState() {
		try {
			var raw = window.localStorage.getItem( STORAGE_KEY );
			if ( ! raw ) {
				return Object.assign( {}, DEFAULTS );
			}
			var parsed = JSON.parse( raw );
			return Object.assign( {}, DEFAULTS, parsed );
		} catch ( e ) {
			return Object.assign( {}, DEFAULTS );
		}
	}

	function saveState() {
		try {
			window.localStorage.setItem( STORAGE_KEY, JSON.stringify( state ) );
		} catch ( e ) {
			// Storage unavailable (private browsing, etc.) - the controls
			// still work for this page view, they just won't persist.
		}
	}

	/* -------------------------------------------------------------- *
	 * Icons - small inline SVGs, no external icon font/library needed
	 * so this plugin has zero front-end dependencies.
	 * -------------------------------------------------------------- */

	function svg( inner, size ) {
		return '<svg width="' + ( size || 16 ) + '" height="' + ( size || 16 ) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
	}
	function iconPerson() {
		return svg( '<circle cx="12" cy="4" r="2"></circle><path d="M12 8v5M12 8l-6 2M12 8l6 2M12 13l-3 7M12 13l3 7"></path>', 26 );
	}
	function iconClose() {
		return svg( '<path d="M6 6l12 12M18 6L6 18"></path>', 22 );
	}
	function iconSpeaker() {
		return svg( '<path d="M4 9v6h4l5 4V5L8 9H4z"></path><path d="M17 9a5 5 0 0 1 0 6"></path>' );
	}
	function iconFontSize() {
		return svg( '<path d="M6 4v3M2 4h8M6 7v13M14 20l4-11 4 11M15.5 16h5"></path>' );
	}
	function iconLines() {
		return svg( '<path d="M4 6h16M4 12h16M4 18h16"></path>' );
	}
	function iconSpacing() {
		return svg( '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"></path>' );
	}
	function iconBold() {
		return svg( '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"></path>' );
	}
	function iconDyslexia() {
		return svg( '<path d="M4 18V6M4 12h5M4 6h5M15 18l4-12M23 18l-4-12"></path>', 16 );
	}
	function iconContrast() {
		return svg( '<circle cx="12" cy="12" r="9"></circle><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"></path>' );
	}
	function iconDroplet() {
		return svg( '<path d="M12 3s6 6.5 6 10.5A6 6 0 0 1 6 13.5C6 9.5 12 3 12 3z"></path>' );
	}
	function iconInvert() {
		return svg( '<circle cx="12" cy="12" r="9"></circle><path d="M12 3v18"></path>' );
	}
	function iconCircle() {
		return svg( '<circle cx="12" cy="12" r="9" fill="currentColor" stroke="none"></circle>' );
	}
	function iconReset() {
		return svg( '<path d="M3 12a9 9 0 1 1 3 6.7"></path><path d="M3 21v-6h6"></path>', 18 );
	}
	function iconGlobe() {
		return svg( '<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"></path>', 16 );
	}
	function iconChevron() {
		return svg( '<path d="M6 9l6 6 6-6"></path>', 14 );
	}

	/* -------------------------------------------------------------- *
	 * DOM helpers
	 * -------------------------------------------------------------- */

	function el( tag, attrs, children ) {
		var node = document.createElement( tag );
		attrs = attrs || {};
		Object.keys( attrs ).forEach( function ( key ) {
			if ( 'class' === key ) {
				node.className = attrs[ key ];
			} else if ( 'html' === key ) {
				node.innerHTML = attrs[ key ];
			} else if ( 'text' === key ) {
				node.textContent = attrs[ key ];
			} else {
				node.setAttribute( key, attrs[ key ] );
			}
		} );
		( children || [] ).forEach( function ( child ) {
			node.appendChild( child );
		} );
		return node;
	}

	/* -------------------------------------------------------------- *
	 * Effect application
	 * -------------------------------------------------------------- */

	function applyAll() {
		var html = document.documentElement;

		html.style.zoom = ( state.fontSize / 100 ) || 1;

		[ 1, 2 ].forEach( function ( level ) {
			html.classList.remove( 'sta11y-lh-' + level, 'sta11y-ls-' + level, 'sta11y-fw-' + level );
		} );
		if ( state.lineHeight > 0 ) {
			html.classList.add( 'sta11y-lh-' + state.lineHeight );
		}
		if ( state.letterSpacing > 0 ) {
			html.classList.add( 'sta11y-ls-' + state.letterSpacing );
		}
		if ( state.fontWeight > 0 ) {
			html.classList.add( 'sta11y-fw-' + state.fontWeight );
		}

		html.classList.toggle( 'sta11y-dyslexia', state.dyslexiaFont > 0 );
		html.classList.toggle( 'sta11y-high-contrast', state.highContrast > 0 );

		var filters = [];
		if ( 1 === state.contrast ) {
			filters.push( 'contrast(1.3)' );
		} else if ( 2 === state.contrast ) {
			filters.push( 'contrast(1.6)' );
		}
		if ( 1 === state.saturation ) {
			filters.push( 'saturate(0.5)' );
		} else if ( 2 === state.saturation ) {
			filters.push( 'saturate(0)' );
		}
		if ( state.invert > 0 ) {
			filters.push( 'invert(1) hue-rotate(180deg)' );
		}
		applyPageFilter( filters.join( ' ' ) );

		html.classList.toggle( 'sta11y-tts-active', !! state.tts );
		setTtsActive( !! state.tts );
	}

	/**
	 * Applies the composed contrast/saturation/invert filter to each of
	 * <body>'s own top-level children instead of to <html> or <body>
	 * itself. A non-"none" `filter` on an ancestor makes it the containing
	 * block for any `position: fixed` descendant (same rule as
	 * `transform`) - setting it on <html> broke this widget's own fixed
	 * positioning the moment Contrast/Saturation/Invert was used (it would
	 * anchor to the full document box instead of the viewport, so on a
	 * long page the button could end up scrolled far out of view). Since
	 * contrast/saturate/invert are plain per-pixel color transforms with
	 * no cross-element blending to preserve, filtering each top-level
	 * sibling individually looks identical to filtering their shared
	 * parent once - without ever giving that parent a fixed containing
	 * block. The widget's own root(s) are skipped so toggling these
	 * settings never visually mangles the widget controls themselves.
	 */
	function applyPageFilter( filterValue ) {
		Array.prototype.forEach.call( document.body.children, function ( child ) {
			if ( child.classList.contains( 'staa11y-root' ) || child.classList.contains( 'stachat-root' ) ) {
				child.style.filter = '';
				return;
			}
			child.style.filter = filterValue;
		} );
	}

	function setTtsActive( active ) {
		if ( active && ! ttsHandler ) {
			ttsHandler = function ( e ) {
				var target = e.target.closest( 'p, h1, h2, h3, h4, h5, h6, li, a, button, td, th, blockquote, figcaption, label, dt, dd' );
				if ( ! target || target.closest( '.staa11y-root' ) ) {
					return;
				}
				var text = ( target.textContent || '' ).trim();
				if ( ! text ) {
					return;
				}
				e.preventDefault();
				e.stopPropagation();
				try {
					window.speechSynthesis.cancel();
					window.speechSynthesis.speak( new window.SpeechSynthesisUtterance( text ) );
				} catch ( err ) {
					// Web Speech API unavailable in this browser - the hover
					// outline still shows, it just won't actually speak.
				}
			};
			document.addEventListener( 'click', ttsHandler, true );
		} else if ( ! active && ttsHandler ) {
			document.removeEventListener( 'click', ttsHandler, true );
			ttsHandler = null;
			try {
				window.speechSynthesis.cancel();
			} catch ( err ) {}
		}
	}

	/* -------------------------------------------------------------- *
	 * UI sync (visual state of the panel's controls)
	 * -------------------------------------------------------------- */

	function updateUI() {
		ui.fontSizeValue.textContent = state.fontSize + '%';
		ui.fontSizeSlider.value = state.fontSize;

		ui.ttsCard.classList.toggle( 'is-on', !! state.tts );

		GRID_CONTROLS.forEach( function ( ctrl ) {
			var card = ui.gridCards[ ctrl.key ];
			var level = state[ ctrl.key ];
			card.classList.remove( 'is-active-1', 'is-active-2' );
			if ( level > 0 ) {
				card.classList.add( 'is-active-' + level );
			}
		} );

		// ui.langCode only exists when the language list is non-empty (see
		// buildLanguageControl() - an admin can clear the list entirely to
		// hide the switcher), so every other control's sync above must not
		// be skipped by a language-related error.
		if ( ui.langCode ) {
			var current = config.languages.filter( function ( lang ) {
				return lang.code === state.language;
			} )[ 0 ];
			ui.langCode.textContent = current && current.code ? current.code.split( '-' )[ 0 ].toUpperCase() : 'EN';
		}
	}

	/* -------------------------------------------------------------- *
	 * Widget construction
	 * -------------------------------------------------------------- */

	function buildGridCard( ctrl ) {
		var card = el( 'div', { class: 'staa11y-card staa11y-grid-card' } );
		var badge = el( 'span', { class: 'staa11y-icon-badge', html: ctrl.icon } );
		var labelRow = el( 'span', { class: 'staa11y-label' }, [ badge, el( 'span', { text: ctrl.label } ) ] );
		var dots = el( 'span', { class: 'staa11y-dots' } );
		for ( var i = 0; i < ctrl.max; i++ ) {
			dots.appendChild( el( 'span', {} ) );
		}
		labelRow.appendChild( dots );
		card.appendChild( labelRow );

		card.addEventListener( 'click', function () {
			state[ ctrl.key ] = ( state[ ctrl.key ] + 1 ) % ( ctrl.max + 1 );
			saveState();
			applyAll();
			updateUI();
		} );

		ui.gridCards[ ctrl.key ] = card;
		return card;
	}

	function buildWidget() {
		ui.gridCards = {};

		var root = el( 'div', {
			class: 'staa11y-root is-' + config.position,
			style: '--staa11y-color:' + config.color + ';',
		} );

		var fab = el( 'button', { class: 'staa11y-fab', type: 'button', 'aria-label': config.strings.open, html: iconPerson() } );

		var panel = el( 'div', { class: 'staa11y-panel', role: 'dialog', 'aria-label': config.strings.title } );

		var header = el( 'div', { class: 'staa11y-header' }, [
			el( 'span', { html: iconPerson() } ),
			el( 'span', { text: config.strings.title } ),
		] );

		var body = el( 'div', { class: 'staa11y-body' } );

		// Speech
		body.appendChild( el( 'p', { class: 'staa11y-section-label', text: config.strings.speech } ) );
		var ttsCard = el( 'div', { class: 'staa11y-card staa11y-row-card' } );
		ttsCard.appendChild( el( 'span', { class: 'staa11y-label' }, [
			el( 'span', { class: 'staa11y-icon-badge', html: iconSpeaker() } ),
			el( 'span', { text: config.strings.textToSpeech } ),
		] ) );
		ttsCard.appendChild( el( 'span', { class: 'staa11y-switch' } ) );
		ttsCard.addEventListener( 'click', function () {
			state.tts = ! state.tts;
			saveState();
			applyAll();
			updateUI();
			if ( state.tts ) {
				showTtsHint( root );
			}
		} );
		ui.ttsCard = ttsCard;
		body.appendChild( ttsCard );

		// Text
		body.appendChild( el( 'p', { class: 'staa11y-section-label', text: config.strings.text } ) );

		var fontSizeCard = el( 'div', { class: 'staa11y-card' } );
		var fontSizeTop = el( 'div', { class: 'staa11y-row-card' }, [
			el( 'span', { class: 'staa11y-label' }, [
				el( 'span', { class: 'staa11y-icon-badge', html: iconFontSize() } ),
				el( 'span', { text: config.strings.fontSize } ),
			] ),
			el( 'span', { class: 'staa11y-slider-value' } ),
		] );
		var slider = el( 'input', { type: 'range', min: '80', max: '200', step: '5', class: 'staa11y-slider' } );
		slider.addEventListener( 'input', function () {
			state.fontSize = parseInt( slider.value, 10 );
			saveState();
			applyAll();
			updateUI();
		} );
		fontSizeCard.appendChild( fontSizeTop );
		fontSizeCard.appendChild( slider );
		ui.fontSizeValue = fontSizeTop.querySelector( '.staa11y-slider-value' );
		ui.fontSizeSlider = slider;
		body.appendChild( fontSizeCard );

		var textGrid = el( 'div', { class: 'staa11y-grid' } );
		[ 'lineHeight', 'letterSpacing', 'fontWeight', 'dyslexiaFont' ].forEach( function ( key ) {
			var ctrl = GRID_CONTROLS.filter( function ( c ) { return c.key === key; } )[ 0 ];
			textGrid.appendChild( buildGridCard( ctrl ) );
		} );
		body.appendChild( textGrid );

		// Color & Contrast
		body.appendChild( el( 'p', { class: 'staa11y-section-label', text: config.strings.colorContrast } ) );
		var colorGrid = el( 'div', { class: 'staa11y-grid' } );
		[ 'contrast', 'saturation', 'invert', 'highContrast' ].forEach( function ( key ) {
			var ctrl = GRID_CONTROLS.filter( function ( c ) { return c.key === key; } )[ 0 ];
			colorGrid.appendChild( buildGridCard( ctrl ) );
		} );
		body.appendChild( colorGrid );

		// Footer: reset + language
		var footer = el( 'div', { class: 'staa11y-footer' } );

		var resetBtn = el( 'button', { type: 'button', class: 'staa11y-reset' }, [
			el( 'span', { html: iconReset() } ),
			el( 'span', { text: config.strings.resetSettings } ),
		] );
		resetBtn.addEventListener( 'click', function () {
			var hadTranslation = !! state.language;
			state = Object.assign( {}, DEFAULTS, { language: '' } );
			saveState();
			if ( hadTranslation ) {
				// restoreOriginalLanguage() reloads the page - state is
				// already saved above, so the fresh load picks up the
				// fully-reset values via loadState()/applyAll().
				restoreOriginalLanguage();
				return;
			}
			applyAll();
			updateUI();
		} );
		footer.appendChild( resetBtn );

		if ( config.languages && config.languages.length ) {
			footer.appendChild( buildLanguageControl() );
		}

		panel.appendChild( header );
		panel.appendChild( body );
		panel.appendChild( footer );

		root.appendChild( panel );
		root.appendChild( fab );
		document.body.appendChild( root );

		fab.addEventListener( 'click', function () {
			var open = root.classList.toggle( 'is-open' );
			fab.innerHTML = open ? iconClose() : iconPerson();
			fab.setAttribute( 'aria-label', open ? config.strings.close : config.strings.open );
		} );

		document.addEventListener( 'click', function ( e ) {
			if ( root.classList.contains( 'is-open' ) && ! root.contains( e.target ) ) {
				root.classList.remove( 'is-open' );
				fab.innerHTML = iconPerson();
				fab.setAttribute( 'aria-label', config.strings.open );
			}
		} );

		updateUI();
	}

	function buildLanguageControl() {
		var wrap = el( 'div', { class: 'staa11y-lang' } );
		var toggle = el( 'button', { type: 'button', class: 'staa11y-lang-toggle' }, [
			el( 'span', {} , [ el( 'span', { html: iconGlobe() } ) ] ),
			el( 'span', { class: 'staa11y-lang-code', text: 'EN' } ),
			el( 'span', { html: iconChevron() } ),
		] );
		var dropdown = el( 'div', { class: 'staa11y-lang-dropdown' } );

		config.languages.forEach( function ( lang ) {
			var option = el( 'button', { type: 'button', class: 'staa11y-lang-option', text: lang.label } );
			option.addEventListener( 'click', function () {
				dropdown.classList.remove( 'is-open' );
				state.language = lang.code;
				updateUI();
				applyTranslation( lang.code );
			} );
			dropdown.appendChild( option );
		} );

		toggle.addEventListener( 'click', function ( e ) {
			e.stopPropagation();
			dropdown.classList.toggle( 'is-open' );
		} );
		document.addEventListener( 'click', function () {
			dropdown.classList.remove( 'is-open' );
		} );

		wrap.appendChild( dropdown );
		wrap.appendChild( toggle );

		ui.langCode = toggle.querySelector( '.staa11y-lang-code' );

		return wrap;
	}

	function showTtsHint( root ) {
		var hint = el( 'div', { class: 'staa11y-tts-hint', text: config.strings.ttsClickHint } );
		document.body.appendChild( hint );
		window.setTimeout( function () {
			hint.remove();
		}, 4000 );
	}

	/* -------------------------------------------------------------- *
	 * Google Translate integration
	 * -------------------------------------------------------------- */

	function suppressGoogleTranslateChrome() {
		var enforce = function () {
			document.querySelectorAll( '.goog-te-banner-frame' ).forEach( function ( frame ) {
				frame.style.display = 'none';
			} );
			if ( document.body.style.top && '0px' !== document.body.style.top ) {
				document.body.style.top = '0px';
			}
			document.documentElement.style.removeProperty( 'top' );
		};

		enforce();
		new MutationObserver( enforce ).observe( document.body, { attributes: true, attributeFilter: [ 'style' ] } );
		new MutationObserver( enforce ).observe( document.documentElement, { childList: true } );
		new MutationObserver( enforce ).observe( document.body, { childList: true } );
	}

	function withTranslateSelect( callback, attemptsLeft ) {
		var select = document.querySelector( '.goog-te-combo' );
		if ( select ) {
			callback( select );
			return;
		}
		if ( attemptsLeft > 0 ) {
			window.setTimeout( function () {
				withTranslateSelect( callback, attemptsLeft - 1 );
			}, 300 );
		}
	}

	function applyTranslation( code ) {
		if ( '' === code ) {
			restoreOriginalLanguage();
			return;
		}
		withTranslateSelect( function ( select ) {
			select.value = code;
			select.dispatchEvent( new Event( 'change' ) );
		}, 10 );
	}

	/**
	 * Setting the hidden <select class="goog-te-combo"> back to an empty
	 * value does not reliably undo a translation - Google's widget tracks
	 * the active language via its own `googtrans` cookie and re-applies it
	 * from there on every load/DOM mutation, so the select alone can't
	 * override that. Clearing the cookie (both with and without a leading
	 * dot, since Google sets it either way depending on version) and doing
	 * a full reload is the standard, reliable way to actually restore the
	 * original page.
	 */
	function restoreOriginalLanguage() {
		try {
			var hostname = window.location.hostname;
			var expire = 'expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
			document.cookie = 'googtrans=; ' + expire;
			document.cookie = 'googtrans=; ' + expire + ' domain=' + hostname + ';';
			document.cookie = 'googtrans=; ' + expire + ' domain=.' + hostname + ';';
		} catch ( e ) {}
		window.location.reload();
	}

	/* -------------------------------------------------------------- *
	 * Init
	 * -------------------------------------------------------------- */

	function init() {
		if ( document.getElementById( 'google_translate_element' ) ) {
			suppressGoogleTranslateChrome();
		}
		buildWidget();
		applyAll();
	}

	if ( 'loading' === document.readyState ) {
		document.addEventListener( 'DOMContentLoaded', init );
	} else {
		init();
	}
} )();
