/**
 * Browser push notification subscription flow: a delayed popup asking for
 * permission, service worker registration, PushManager subscription, and
 * submission to the REST API. Every network/permission call here is async
 * and runs well after first paint, so it never affects page-load
 * performance.
 */

(function () {
	'use strict';

	if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
		return;
	}

	var config = window.staPush || {};
	var DISMISS_KEY = 'stapush_dismissed_at';
	var SUBSCRIBED_KEY = 'stapush_subscribed';
	var VISITOR_ID_KEY = 'stapush_visitor_id';
	var SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
	var POPUP_DELAY_MS = 5000;

	function urlBase64ToUint8Array(base64String) {
		var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
		var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
		var rawData = window.atob(base64);
		var outputArray = new Uint8Array(rawData.length);
		for (var i = 0; i < rawData.length; ++i) {
			outputArray[i] = rawData.charCodeAt(i);
		}
		return outputArray;
	}

	function uuid() {
		if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
			var r = (Math.random() * 16) | 0;
			var v = c === 'x' ? r : (r & 0x3) | 0x8;
			return v.toString(16);
		});
	}

	// Reuses the theme's own visitor-tracking ID when present (same
	// localStorage-in-the-same-browser, so it's the same visitor either
	// way) — this is what lets the plugin's server side opportunistically
	// pull in already-collected city/state data for audience targeting.
	function getVisitorId() {
		var themeId = localStorage.getItem('stapc_visitor_id');
		if (themeId) return themeId;

		var id = localStorage.getItem(VISITOR_ID_KEY);
		if (!id) {
			id = uuid();
			localStorage.setItem(VISITOR_ID_KEY, id);
		}
		return id;
	}

	function isReturningVisitor() {
		var key = 'stapush_seen_before';
		var seen = localStorage.getItem(key);
		localStorage.setItem(key, '1');
		return Boolean(seen);
	}

	function detectDeviceType(ua) {
		if (/tablet|ipad/i.test(ua)) return 'tablet';
		if (/mobi|android|iphone/i.test(ua)) return 'mobile';
		return 'desktop';
	}

	function detectOS(ua) {
		if (/windows/i.test(ua)) return 'Windows';
		if (/mac os x/i.test(ua)) return 'macOS';
		if (/android/i.test(ua)) return 'Android';
		if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
		if (/linux/i.test(ua)) return 'Linux';
		return 'Unknown';
	}

	function detectBrowser(ua) {
		if (/edg\//i.test(ua)) return 'Edge';
		if (/opr\//i.test(ua) || /opera/i.test(ua)) return 'Opera';
		if (/chrome/i.test(ua) && !/chromium/i.test(ua)) return 'Chrome';
		if (/crios/i.test(ua)) return 'Chrome';
		if (/fxios/i.test(ua) || /firefox/i.test(ua)) return 'Firefox';
		if (/safari/i.test(ua) && !/chrome/i.test(ua)) return 'Safari';
		return 'Unknown';
	}

	// Interest tags inferred from the page a visitor subscribes on — a
	// lightweight, no-login proxy for "NDIS client" / "Home Care Package
	// client" / "Community Nursing" audience segments.
	function interestTags() {
		var path = window.location.pathname.toLowerCase();
		var tags = [isReturningVisitor() ? 'returning_visitors' : 'new_visitors'];

		if (path.indexOf('ndis') !== -1) tags.push('ndis_clients');
		if (path.indexOf('home-care') !== -1) tags.push('home_care_clients');
		if (path.indexOf('nursing') !== -1) tags.push('community_nursing');

		return tags.join(',');
	}

	function apiFetch(path, options) {
		options = options || {};
		options.headers = Object.assign({ 'Content-Type': 'application/json', 'X-WP-Nonce': config.restNonce || '' }, options.headers || {});
		options.credentials = 'same-origin';
		return fetch((config.restUrl || '/wp-json/sta/v1/push/') + path, options);
	}

	function submitSubscription(pushSubscription) {
		var key = pushSubscription.getKey ? pushSubscription.getKey('p256dh') : null;
		var auth = pushSubscription.getKey ? pushSubscription.getKey('auth') : null;
		var ua = navigator.userAgent || '';

		var body = {
			endpoint: pushSubscription.endpoint,
			keys: {
				p256dh: key ? arrayBufferToBase64Url(key) : '',
				auth: auth ? arrayBufferToBase64Url(auth) : '',
			},
			visitor_id: getVisitorId(),
			browser: detectBrowser(ua),
			operating_system: detectOS(ua),
			device: detectDeviceType(ua),
			language: navigator.language || '',
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
			audience_tags: interestTags(),
		};

		return apiFetch('subscribe', { method: 'POST', body: JSON.stringify(body) })
			.then(function (response) {
				if (!response.ok) throw new Error('Subscribe request failed');
				localStorage.setItem(SUBSCRIBED_KEY, '1');
				return response.json();
			})
			.catch(function (error) {
				// Likely offline — queue a background sync so the
				// subscription still reaches the server once connectivity
				// returns, instead of silently being lost.
				return navigator.serviceWorker.ready
					.then(function (registration) {
						if (registration.sync) return registration.sync.register('stapush-sync-subscription');
					})
					.finally(function () {
						throw error;
					});
			});
	}

	function arrayBufferToBase64Url(buffer) {
		var bytes = new Uint8Array(buffer);
		var binary = '';
		for (var i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
		return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	}

	function registerAndSubscribe() {
		if (!config.vapidPublicKey) return Promise.reject(new Error('Missing VAPID key'));

		return navigator.serviceWorker
			.register(config.serviceWorkerUrl, { scope: '/' })
			.then(function () {
				return navigator.serviceWorker.ready;
			})
			.then(function (registration) {
				return registration.pushManager.getSubscription().then(function (existing) {
					if (existing) return existing;

					return registration.pushManager.subscribe({
						userVisibleOnly: true,
						applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey),
					});
				});
			})
			.then(submitSubscription);
	}

	// -----------------------------------------------------------------
	// Popup UI
	// -----------------------------------------------------------------

	function createPopup() {
		var popup = document.createElement('div');
		popup.className = 'stapush-popup';
		popup.setAttribute('role', 'dialog');
		popup.setAttribute('aria-live', 'polite');
		popup.setAttribute('aria-label', 'Notification permission request');

		popup.innerHTML =
			'<div class="stapush-popup__card">' +
			'<p class="stapush-popup__title">Stay Connected</p>' +
			'<p class="stapush-popup__text">Receive important care updates, NDIS information, appointment reminders, and community news.</p>' +
			'<div class="stapush-popup__actions">' +
			'<button type="button" class="stapush-popup__btn stapush-popup__btn--primary stapush-popup__enable">Enable Notifications</button>' +
			'<button type="button" class="stapush-popup__btn stapush-popup__btn--ghost stapush-popup__later">Maybe Later</button>' +
			'</div>' +
			'<p class="stapush-popup__success" hidden>&#10003; Notifications Enabled<br><span>You’ll now receive important updates.</span></p>' +
			'</div>';

		return popup;
	}

	function showPopup() {
		var popup = createPopup();
		document.body.appendChild(popup);
		requestAnimationFrame(function () { popup.classList.add('is-visible'); });

		function dismiss() {
			popup.classList.remove('is-visible');
			setTimeout(function () { popup.remove(); }, 400);
		}

		popup.querySelector('.stapush-popup__later').addEventListener('click', function () {
			localStorage.setItem(DISMISS_KEY, String(Date.now()));
			dismiss();
		});

		popup.querySelector('.stapush-popup__enable').addEventListener('click', function (event) {
			var button = event.currentTarget;
			button.disabled = true;

			Notification.requestPermission()
				.then(function (permission) {
					if (permission !== 'granted') {
						localStorage.setItem(DISMISS_KEY, String(Date.now()));
						dismiss();
						return null;
					}

					return registerAndSubscribe().then(function () {
						popup.querySelector('.stapush-popup__actions').hidden = true;
						popup.querySelector('.stapush-popup__success').hidden = false;
						setTimeout(dismiss, 2200);
					});
				})
				.catch(function () {
					dismiss();
				});
		});
	}

	function init() {
		if (Notification.permission === 'granted') {
			registerAndSubscribe().catch(function () {});
			return;
		}

		if (Notification.permission === 'denied') {
			return;
		}

		var dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
		if (dismissedAt && Date.now() - dismissedAt < SEVEN_DAYS_MS) {
			return;
		}

		setTimeout(showPopup, POPUP_DELAY_MS);
	}

	if ('serviceWorker' in navigator) {
		navigator.serviceWorker.addEventListener('message', function (event) {
			if (event.data && event.data.type === 'stapush-retry-subscription') {
				navigator.serviceWorker.ready
					.then(function (registration) { return registration.pushManager.getSubscription(); })
					.then(function (subscription) { if (subscription) return submitSubscription(subscription); })
					.catch(function () {});
			}
		});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
