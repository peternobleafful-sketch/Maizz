# Church Manager "My giving" link (step 8)

For whoever builds the Church Manager side (WordPress backend). Maizz never touches the Church Manager code; this page is everything needed.

## What it does

1. A signed-in member taps **Give now** in Church Manager. The app opens a **browser page** on Maizz (never a pay button inside the app, which keeps Apple happy).
2. The link carries a signed tag saying "this is member `u123` of church `grace-chapel`". A gift made through it is stored with that opaque reference. No name, phone or email is added.
3. Under **My giving**, Church Manager's WordPress backend asks Maizz for that member's **paid gifts to their own church** and shows them.

Gifts made **anonymously** are never tagged, so they can never appear in anyone's history. Gifts made without the link are not tagged either (Maizz cannot prove who a phone number belongs to).

## Set up, once per church

1. Kobina adds `MEMBER_LINK_MASTER_KEY` in Vercel (Production, Sensitive) and redeploys.
2. On the Maizz owner site: **Churches → Manage → Church Manager link → Turn on**.
3. **Show the secret key** (needs a fresh code). It is 64 letters and digits. Copy it straight into the Church Manager server settings (below). Do not email it, paste it in chat, or put it in the app, in JavaScript, or in the database.
4. If it ever leaks: **Make a new key**. The old one stops working at once. Give the new one to Church Manager.

## Rules for the Church Manager side

- Keep the key in `wp-config.php` (server only). The phone app and browser JavaScript must never see it.
- The **member reference** is chosen by the server from the signed-in user (for example `u` + the WordPress user id). Never take it from the request. Allowed characters: letters, digits, `-`, `_`, up to 64. Do not use a name, phone number or email.
- The history call is made by the server, for the signed-in member only, for the church they belong to.

## The "Give now" link

`https://<maizz>/give/<church-slug>?m=<member>&e=<expiry>&s=<signature>`

- `expiry`: Unix time in seconds. Must be in the future, and no more than 6 hours ahead. Make the link fresh each time the page is shown (1 hour is fine).
- `signature`: lower-case hex HMAC-SHA256 of the text `link.<church-slug>.<member>.<expiry>`, using the church key as the secret (the 64-character key as plain text, not decoded).

## The history call

`POST https://<maizz>/api/church-manager/history` with JSON `{"church": "...", "member": "...", "timestamp": 1800000000, "signature": "..."}`

- `timestamp`: now, Unix seconds (within 5 minutes either way, so keep the server clock right).
- `signature`: HMAC-SHA256 of `history.<church-slug>.<member>.<timestamp>`, same key.

Reply (amounts are whole pesewas; 10000 = GH₵100.00):

```json
{ "church": "grace-chapel", "currency": "GHS",
  "gifts": [ { "date": "2026-10-11T09:12:00Z", "type": "tithe", "giftPesewas": 10000, "paidPesewas": 10301, "refundedPesewas": 0 } ] }
```

`giftPesewas` is what the church received, `paidPesewas` what the member paid with fees. Newest first, up to 500. Every refusal (wrong key, old timestamp, link switched off, unknown church) is the same `401 {"error":"Not allowed"}`. Too many wrong requests from one place give `429`; wait a few minutes. Cache the answer for a minute or so rather than asking on every screen.

## WordPress code (add to a small plugin or the theme's `functions.php`)

In `wp-config.php`:

```php
define('MAIZZ_BASE',   'https://maizz-nu.vercel.app');
define('MAIZZ_CHURCH', 'grace-chapel');      // the church's address on Maizz
define('MAIZZ_KEY',    'PASTE-THE-64-CHARACTER-KEY-HERE');
```

Code:

```php
<?php
// Maizz: the reference of the signed-in member. Chosen by the server, never by the request.
function maizz_member_ref(): ?string {
    $id = get_current_user_id();
    return $id ? 'u' . $id : null;
}

function maizz_sign(string $text): string {
    return hash_hmac('sha256', $text, MAIZZ_KEY);
}

// The "Give now" address. Make it fresh each time the page is shown.
function maizz_give_url(): ?string {
    $m = maizz_member_ref();
    if (!$m) return null;
    $exp = time() + 3600;
    $sig = maizz_sign('link.' . MAIZZ_CHURCH . '.' . $m . '.' . $exp);
    return MAIZZ_BASE . '/give/' . rawurlencode(MAIZZ_CHURCH) . '?' . http_build_query(['m' => $m, 'e' => $exp, 's' => $sig]);
}

// The member's paid gifts to this church, or null if Maizz could not be reached.
function maizz_history(): ?array {
    $m = maizz_member_ref();
    if (!$m) return null;
    $cache = 'maizz_hist_' . md5($m);
    $hit = get_transient($cache);
    if (is_array($hit)) return $hit;
    $ts = time();
    $res = wp_remote_post(MAIZZ_BASE . '/api/church-manager/history', [
        'timeout' => 10,
        'headers' => ['Content-Type' => 'application/json'],
        'body'    => wp_json_encode([
            'church'    => MAIZZ_CHURCH,
            'member'    => $m,
            'timestamp' => $ts,
            'signature' => maizz_sign('history.' . MAIZZ_CHURCH . '.' . $m . '.' . $ts),
        ]),
    ]);
    if (is_wp_error($res) || wp_remote_retrieve_response_code($res) !== 200) return null;
    $data = json_decode(wp_remote_retrieve_body($res), true);
    if (!is_array($data) || !isset($data['gifts']) || !is_array($data['gifts'])) return null;
    set_transient($cache, $data['gifts'], 60);
    return $data['gifts'];
}
```

Show amounts with `number_format($pesewas / 100, 2)`. Whole pesewas come in, so nothing is lost.

## Check the signing code is right

With the key `aaaa…` (64 times `a`), church `grace-chapel` and member `u123`:

- `hash_hmac('sha256', 'link.grace-chapel.u123.1800000600', $key)` must equal `9c69f6fb0cf2c9ced69c486db59a0cb6c64046ac1d3a970c58b1f6bf72abbe24`
- `hash_hmac('sha256', 'history.grace-chapel.u123.1800000000', $key)` must equal `d7109eede7327a6fbbe19f9b89a1e56b90cc0fc295c347a29f0cf93322729a23`

## Test mode

While Maizz is in test mode, use test gifts only. After a test gift through the link is paid, it appears in the member's history. A gift made with the link switched off, an old link, or "give anonymously" ticked does not.
