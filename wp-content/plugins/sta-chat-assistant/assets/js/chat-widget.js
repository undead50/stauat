/**
 * STA Chat Assistant widget. Vanilla JS, no dependencies. Holds the
 * conversation's `stage` and `collected` fields in memory between turns
 * and sends them back to the REST endpoint with every message - the
 * server (includes/class-conversation.php) is stateless, so this is the
 * only place that multi-turn referral progress lives.
 */
( function () {
	'use strict';

	if ( typeof window.staChat === 'undefined' ) {
		return;
	}

	var config  = window.staChat;
	var state   = { stage: 'idle', collected: {} };
	var opened  = false;
	var sending = false;
	// The quick-reply block for the *current* turn, tracked so the next
	// turn can remove it - it lives inside .stachat-messages (see
	// renderQuickReplies()), not a separate persistent container.
	var currentQuickReplies = null;

	function el( tag, attrs, children ) {
		var node = document.createElement( tag );
		attrs = attrs || {};

		Object.keys( attrs ).forEach( function ( key ) {
			if ( 'class' === key ) {
				node.className = attrs[ key ];
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

	function bubbleIconSvg() {
		return '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>';
	}

	function buildWidget() {
		var root = el( 'div', { class: 'stachat-root', style: '--stachat-brand:' + config.brandColor + ';' } );

		// Messenger-style "chat head": the closed bubble's own icon, plus a
		// small white-ringed green dot layered on top, same corner Messenger
		// uses to show a contact is online.
		var bubble = el( 'button', { class: 'stachat-bubble', type: 'button', 'aria-label': config.strings.open } );
		bubble.innerHTML = bubbleIconSvg();
		bubble.appendChild( el( 'span', { class: 'stachat-status-dot', 'aria-hidden': 'true' } ) );

		var panel = el( 'div', { class: 'stachat-panel' } );

		// Header mirrors the same "avatar + name + status" layout Messenger
		// uses in its own conversation header, instead of just a plain name.
		var headerAvatar = el( 'span', { class: 'stachat-header-avatar', 'aria-hidden': 'true' } );
		headerAvatar.innerHTML = bubbleIconSvg();
		headerAvatar.appendChild( el( 'span', { class: 'stachat-status-dot', 'aria-hidden': 'true' } ) );
		var headerText = el( 'span', { class: 'stachat-header-text' }, [
			el( 'span', { class: 'stachat-header-name', text: config.botName } ),
			el( 'span', { class: 'stachat-header-status', text: config.strings.activeNow } ),
		] );
		var headerInfo = el( 'span', { class: 'stachat-header-info' }, [ headerAvatar, headerText ] );
		var header      = el( 'div', { class: 'stachat-header' }, [ headerInfo ] );
		var closeBtn    = el( 'button', { class: 'stachat-close', type: 'button', 'aria-label': config.strings.close, text: '✕' } );
		header.appendChild( closeBtn );

		var messages = el( 'div', { class: 'stachat-messages', role: 'log', 'aria-live': 'polite' } );

		var form      = el( 'form', { class: 'stachat-form' } );
		var honeypot  = el( 'input', { type: 'text', name: 'hp', tabindex: '-1', autocomplete: 'off', class: 'stachat-honeypot', 'aria-hidden': 'true' } );
		var input     = el( 'input', { type: 'text', class: 'stachat-input', placeholder: config.strings.placeholder, autocomplete: 'off' } );
		var sendBtn   = el( 'button', { type: 'submit', class: 'stachat-send', text: config.strings.send } );

		form.appendChild( honeypot );
		form.appendChild( input );
		form.appendChild( sendBtn );

		panel.appendChild( header );
		panel.appendChild( messages );
		panel.appendChild( form );

		// The teaser notification card - a bold name + a short preview line
		// with a speech-bubble tail pointing at the chat head, the same
		// unprompted "new message" nudge Messenger shows next to its own
		// chat heads. Dismissible on its own, independent of the panel.
		var teaserClose = el( 'button', { class: 'stachat-teaser-close', type: 'button', 'aria-label': config.strings.dismissTeaser, text: '✕' } );
		var teaser = el( 'div', { class: 'stachat-teaser', role: 'button', tabindex: '0' }, [
			teaserClose,
			el( 'strong', { class: 'stachat-teaser-name', text: config.botName } ),
			el( 'p', { class: 'stachat-teaser-text', text: config.strings.teaserText } ),
		] );

		root.appendChild( panel );
		root.appendChild( teaser );
		root.appendChild( bubble );
		document.body.appendChild( root );

		// While set, the scroll handler below won't show the teaser even on
		// a qualifying downward scroll - the 20s "hold" after a dismiss.
		var TEASER_HOLD_MS = 20000;
		var teaserHeldUntil = 0;
		var teaserReappearTimer = null;

		function hideTeaser() {
			teaser.classList.remove( 'is-visible' );
		}

		// Dismissing (the X, specifically - not opening the chat) holds the
		// scroll-triggered show/hide below for 20s, then brings the teaser
		// back on its own - a "snooze", not a one-off dismissal, so it isn't
		// gone for good the moment it's closed.
		function dismissTeaser() {
			hideTeaser();
			teaserHeldUntil = Date.now() + TEASER_HOLD_MS;

			if ( teaserReappearTimer ) {
				clearTimeout( teaserReappearTimer );
			}
			teaserReappearTimer = setTimeout( function () {
				teaserHeldUntil = 0;
				if ( ! root.classList.contains( 'is-open' ) ) {
					teaser.classList.add( 'is-visible' );
				}
			}, TEASER_HOLD_MS );
		}

		bubble.addEventListener( 'click', function () {
			hideTeaser();
			if ( root.classList.contains( 'is-open' ) ) {
				closePanel( root );
			} else {
				openPanel( root, messages, honeypot );
			}
		} );

		teaser.addEventListener( 'click', function () {
			hideTeaser();
			openPanel( root, messages, honeypot );
		} );
		teaser.addEventListener( 'keydown', function ( e ) {
			if ( 'Enter' === e.key || ' ' === e.key ) {
				e.preventDefault();
				hideTeaser();
				openPanel( root, messages, honeypot );
			}
		} );
		teaserClose.addEventListener( 'click', function ( e ) {
			e.stopPropagation();
			dismissTeaser();
		} );

		closeBtn.addEventListener( 'click', function () {
			closePanel( root );
		} );

		form.addEventListener( 'submit', function ( e ) {
			e.preventDefault();
			var text = input.value.trim();
			if ( ! text || sending ) {
				return;
			}
			input.value = '';
			appendUserMessage( messages, text );
			clearQuickReplies();
			send( text, messages, honeypot );
		} );

		// Shows on every downward scroll past the threshold and hides again
		// on any upward scroll - including after being dismissed (once its
		// 20s hold above has lapsed), or after the chat's been opened and
		// closed again, so it tracks the current scroll direction rather
		// than being a one-time-per-visit nudge. Suppressed while the panel
		// is actually open, or during that 20s post-dismiss hold.
		var SCROLL_TRIGGER_PX = 400;
		var lastScrollY = window.scrollY;
		window.addEventListener( 'scroll', function () {
			var y = window.scrollY;
			var scrollingDown = y > lastScrollY;
			lastScrollY = y;

			if ( root.classList.contains( 'is-open' ) || Date.now() < teaserHeldUntil ) {
				return;
			}

			if ( scrollingDown && y > SCROLL_TRIGGER_PX ) {
				teaser.classList.add( 'is-visible' );
			} else if ( ! scrollingDown ) {
				teaser.classList.remove( 'is-visible' );
			}
		}, { passive: true } );
	}

	function openPanel( root, messages, honeypot ) {
		root.classList.add( 'is-open' );
		if ( ! opened ) {
			opened = true;
			send( '', messages, honeypot );
		}
	}

	function closePanel( root ) {
		root.classList.remove( 'is-open' );
	}

	function appendUserMessage( messages, text ) {
		var bubble = el( 'div', { class: 'stachat-msg stachat-msg-user' } );
		bubble.textContent = text;
		messages.appendChild( bubble );
		messages.scrollTop = messages.scrollHeight;
	}

	function appendBotMessage( messages, html ) {
		var bubble = el( 'div', { class: 'stachat-msg stachat-msg-bot' } );
		// The REST endpoint only ever returns HTML it built itself from
		// esc_html()/esc_url()-escaped pieces (see class-conversation.php) -
		// never a visitor's raw input reflected back unescaped - so this
		// assignment doesn't introduce an XSS risk.
		bubble.innerHTML = html;
		messages.appendChild( bubble );
		messages.scrollTop = messages.scrollHeight;
	}

	function appendTyping( messages ) {
		var bubble = el( 'div', { class: 'stachat-msg stachat-msg-bot stachat-typing' } );
		bubble.innerHTML = '<span></span><span></span><span></span>';
		messages.appendChild( bubble );
		messages.scrollTop = messages.scrollHeight;
		return bubble;
	}

	function clearQuickReplies() {
		if ( currentQuickReplies ) {
			currentQuickReplies.remove();
			currentQuickReplies = null;
		}
	}

	function renderQuickReplies( messages, replies, honeypot ) {
		clearQuickReplies();

		if ( ! replies || ! replies.length ) {
			return;
		}

		var group = el( 'div', { class: 'stachat-quick-replies' } );

		replies.forEach( function ( reply ) {
			var btn = el( 'button', { type: 'button', class: 'stachat-quick-reply', text: reply.label } );
			btn.addEventListener( 'click', function () {
				appendUserMessage( messages, reply.label );
				clearQuickReplies();
				send( reply.value, messages, honeypot );
			} );
			group.appendChild( btn );
		} );

		// Appended as the last item in the scrollable message list (not a
		// separate fixed-height bar below it) so it scrolls away with the
		// message it belongs to instead of permanently shrinking the
		// space available to read the latest reply.
		messages.appendChild( group );
		currentQuickReplies = group;
		messages.scrollTop = messages.scrollHeight;
	}

	function send( message, messages, honeypot ) {
		sending = true;
		var typing = appendTyping( messages );

		fetch( config.restUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': config.restNonce,
			},
			body: JSON.stringify( {
				message: message,
				stage: state.stage,
				collected: state.collected,
				hp: honeypot ? honeypot.value : '',
			} ),
		} )
			.then( function ( res ) {
				if ( ! res.ok ) {
					throw new Error( 'stachat-request-failed' );
				}
				return res.json();
			} )
			.then( function ( data ) {
				typing.remove();
				sending = false;
				state.stage     = data.stage || 'idle';
				state.collected = data.collected || {};
				if ( data.reply ) {
					appendBotMessage( messages, data.reply );
				}
				renderQuickReplies( messages, data.quick_replies, honeypot );
			} )
			.catch( function () {
				typing.remove();
				sending = false;
				appendBotMessage( messages, config.strings.error );
			} );
	}

	function init() {
		buildWidget();
	}

	if ( 'loading' === document.readyState ) {
		document.addEventListener( 'DOMContentLoaded', init );
	} else {
		init();
	}
} )();
