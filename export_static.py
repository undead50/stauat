#!/usr/bin/env python3
"""
Static, view-only export of the running local WordPress site (client-preview
snapshot to host on GitHub Pages). Crawls every page/post/CPT/taxonomy URL
from the site's own XML sitemaps, downloads every CSS/JS/image asset each
page references, and rewrites every internal link/asset URL to a plain
relative path so the export works from any subpath (a GitHub Pages project
site is served at github.io/<repo>/, not the domain root).

Also applies two export-only fixes that the live WordPress site doesn't
need (both explained inline, at the point they're applied):
  1. The scroll-reveal animation is neutralised so [data-reveal] content
     can never be left permanently invisible if its script is blocked or
     slow (Brave Shields, other privacy browsers, ad blockers, slow
     connections).
  2. A tiny fetch() shim is injected so the chat widget's "message the AI"
     network call - which can only ever reach the real WordPress site's
     REST API, never a static host - fails instantly and quietly into the
     widget's own existing "something went wrong, call us" message, rather
     than hanging on a real cross-origin request and spamming the console
     with CORS errors.

Not carried over (this is a look-and-feel snapshot, not a working site):
  - form submissions (contact, enquiry, newsletter, chat) - no PHP backend
  - the site search box
  - anything that depends on a database query at request time

Run with the python3.11 interpreter that has bs4/lxml/Pillow installed.
"""
import os
import re
import posixpath
import urllib.request
import urllib.error
from urllib.parse import urlsplit, urljoin
from bs4 import BeautifulSoup

BASE = "http://localhost:8080"
OUT = "/Users/ayushpradhan/Documents/Github/sta/static-export"

SITEMAP_INDEX = f"{BASE}/wp-sitemap.xml"

session_headers = {"User-Agent": "Mozilla/5.0 (static-export-bot)"}

# Injected into the <head> of every exported page, before every other
# script, so it's guaranteed to be in place before the chat widget's own
# script (or anything else) ever calls fetch(). See the module docstring.
FETCH_SHIM = """<script>
// Static client-preview only (see README.md): this snapshot has no backend,
// so any call to the WordPress REST API can never succeed - short-circuit
// it immediately into whatever the caller's own failure handling already
// does, instead of a real cross-origin request that hangs, fails with a
// CORS error, and spams the console.
(function () {
  var realFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/wp-json/') !== -1) {
      return Promise.reject(new Error('Static preview: no backend available.'));
    }
    return realFetch.apply(this, arguments);
  };
})();
</script>
"""

# Appended to the theme's compiled stylesheet after it's downloaded. See the
# module docstring, point 1.
REVEAL_FAILSAFE_CSS = """
/* Static client-preview override: this scroll-reveal animation must not
   leave content permanently invisible if its JS is blocked or slow (Brave
   Shields and other privacy browsers, ad blockers, corporate networks,
   slow connections). For this exported, view-only copy, reliability
   matters more than the fade-in, so the animation is turned off entirely
   and every [data-reveal] element just shows immediately, in every
   browser - unlike on the live WordPress site, where the fade/slide-in
   is worth keeping since a broken script there is more fixable. */
.js [data-reveal]{opacity:1 !important;transform:none !important;transition:none !important}
"""


def fetch(url, binary=False):
    req = urllib.request.Request(url, headers=session_headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read()
        ctype = resp.headers.get("Content-Type", "")
    return (data, ctype) if binary else (data.decode("utf-8", "replace"), ctype)


def discover_page_urls():
    xml, _ = fetch(SITEMAP_INDEX)
    sub_sitemaps = re.findall(r"<loc>([^<]+)</loc>", xml)
    urls = set()
    for sm in sub_sitemaps:
        if "wp-sitemap.xml" in sm:
            continue
        try:
            sxml, _ = fetch(sm)
        except Exception as e:
            print("  ! could not fetch sub-sitemap", sm, e)
            continue
        for loc in re.findall(r"<loc>([^<]+)</loc>", sxml):
            urls.add(loc)
    urls.add(BASE + "/")
    return sorted(u for u in urls if u.startswith(BASE))


def url_to_out_dir(url_path):
    p = url_path.strip("/")
    return p


def url_to_out_file(url_path):
    d = url_to_out_dir(url_path)
    return posixpath.join(d, "index.html") if d else "index.html"


def asset_to_out_file(url_path):
    return url_path.lstrip("/")


def rel_from(page_url_path, target_out_file):
    page_dir = url_to_out_dir(page_url_path)
    return posixpath.relpath(target_out_file, start=page_dir if page_dir else ".")


DOWNLOADABLE_LINK_RELS = {"stylesheet", "icon", "shortcut icon", "apple-touch-icon", "manifest", "preload", "modulepreload"}


def is_downloadable_link(el):
    rels = el.get("rel") or []
    if isinstance(rels, str):
        rels = [rels]
    return any(r in DOWNLOADABLE_LINK_RELS for r in rels)


ASSET_ATTRS = [
    ("script", "src"),
    ("img", "src"),
    ("source", "src"),
]

downloaded = {}
pages_html = {}


def save_asset(url):
    parts = urlsplit(url)
    if parts.netloc != urlsplit(BASE).netloc:
        return None
    url_path = parts.path
    if url_path in downloaded:
        return url_path
    try:
        data, ctype = fetch(url, binary=True)
    except (urllib.error.HTTPError, urllib.error.URLError) as e:
        print("  ! failed asset", url, e)
        return None
    out_file = asset_to_out_file(url_path)
    full = os.path.join(OUT, out_file)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "wb") as f:
        f.write(data)
    downloaded[url_path] = True
    return url_path


def main():
    print("Discovering pages from the sitemap...")
    page_urls = discover_page_urls()
    print(f"  {len(page_urls)} pages")

    os.makedirs(OUT, exist_ok=True)

    print("Fetching pages...")
    for url in page_urls:
        path = urlsplit(url).path
        try:
            html, _ = fetch(url)
        except Exception as e:
            print("  ! failed page", url, e)
            continue
        pages_html[path] = BeautifulSoup(html, "lxml")
        print("  fetched", path or "/")

    print("Downloading assets referenced by each page...")
    for path, soup in pages_html.items():
        for tag, attr in ASSET_ATTRS:
            for el in soup.find_all(tag):
                if not el.get(attr):
                    continue
                absolute = urljoin(BASE + path, el[attr])
                save_asset(absolute)
        for el in soup.find_all("link", href=True):
            if is_downloadable_link(el):
                save_asset(urljoin(BASE + path, el["href"]))
        for el in soup.find_all(attrs={"srcset": True}):
            for piece in el["srcset"].split(","):
                u = piece.strip().split(" ")[0]
                if u:
                    save_asset(urljoin(BASE + path, u))

    print(f"  {len(downloaded)} unique assets saved")

    print("Rewriting links and writing HTML...")
    for path, soup in pages_html.items():
        for tag, attr in ASSET_ATTRS:
            for el in soup.find_all(tag):
                if not el.get(attr):
                    continue
                absolute = urljoin(BASE + path, el[attr])
                parts = urlsplit(absolute)
                if parts.netloc != urlsplit(BASE).netloc:
                    continue
                el[attr] = rel_from(path, asset_to_out_file(parts.path))

        for el in soup.find_all("link", href=True):
            if not is_downloadable_link(el):
                continue
            absolute = urljoin(BASE + path, el["href"])
            parts = urlsplit(absolute)
            if parts.netloc != urlsplit(BASE).netloc:
                continue
            el["href"] = rel_from(path, asset_to_out_file(parts.path))

        for el in soup.find_all(attrs={"srcset": True}):
            new_pieces = []
            for piece in el["srcset"].split(","):
                piece = piece.strip()
                if not piece:
                    continue
                bits = piece.split(" ")
                u, descriptor = bits[0], (" " + bits[1] if len(bits) > 1 else "")
                absolute = urljoin(BASE + path, u)
                parts = urlsplit(absolute)
                if parts.netloc != urlsplit(BASE).netloc:
                    new_pieces.append(piece)
                    continue
                new_pieces.append(rel_from(path, asset_to_out_file(parts.path)) + descriptor)
            el["srcset"] = ", ".join(new_pieces)

        for a in soup.find_all("a", href=True):
            href = a["href"]
            if href.startswith(("tel:", "mailto:", "#")) or (href.startswith(("http://", "https://")) and urlsplit(href).netloc != urlsplit(BASE).netloc):
                continue
            absolute = urljoin(BASE + path, href)
            parts = urlsplit(absolute)
            if parts.netloc != urlsplit(BASE).netloc:
                continue
            target_path = parts.path if parts.path.endswith("/") or "." in posixpath.basename(parts.path) else parts.path + "/"
            if "." in posixpath.basename(parts.path):
                a["href"] = rel_from(path, asset_to_out_file(parts.path))
            else:
                a["href"] = rel_from(path, url_to_out_file(target_path))

        # Fetch shim: first thing in <head>, ahead of every other script.
        head = soup.find("head")
        if head is not None:
            shim_soup = BeautifulSoup(FETCH_SHIM, "lxml")
            shim_tag = shim_soup.find("script")
            head.insert(0, shim_tag)

        out_file = os.path.join(OUT, url_to_out_file(path))
        os.makedirs(os.path.dirname(out_file) or OUT, exist_ok=True)
        with open(out_file, "w", encoding="utf-8") as f:
            f.write(str(soup))

    # Reveal fail-safe: append to every downloaded theme stylesheet (there's
    # normally exactly one, main-<hash>.css, but this is written to not
    # depend on knowing its hash).
    css_patched = 0
    for url_path in downloaded:
        if url_path.startswith("/wp-content/themes/stacare/dist/assets/main-") and url_path.endswith(".css"):
            full = os.path.join(OUT, asset_to_out_file(url_path))
            with open(full, "a", encoding="utf-8") as f:
                f.write(REVEAL_FAILSAFE_CSS)
            css_patched += 1
    print(f"  reveal fail-safe appended to {css_patched} stylesheet(s)")

    with open(os.path.join(OUT, ".nojekyll"), "w") as f:
        pass

    print(f"Done. {len(pages_html)} pages, {len(downloaded)} assets, in {OUT}")


if __name__ == "__main__":
    main()
