export default function ApiDocs() {
  return (
    <section className="tab-panel active">
      <div className="panel-header">
        <h1>API Reference</h1>
        <p>Integrate PrintBridge with SMS, bots, Genesys, or any HTTP client.</p>
      </div>
      <div className="api-docs">

        <div className="endpoint">
          <div className="endpoint-header">
            <span className="method get">GET</span><code>/api/printers</code>
          </div>
          <p>List all active printers.</p>
          <pre><code>{`{
  "printers": [
    {
      "id": "uuid",
      "name": "Front Desk",
      "location": "Lobby",
      "print_width_dots": 384,      // 384 / 512 / 576 = 32 / 42 / 48 chars per line
      "client_version": "4.0.0",    // null = old client or never connected
      "last_seen": "2026-05-06T12:00:00"
    }
  ]
}`}</code></pre>
        </div>

        <div className="endpoint">
          <div className="endpoint-header">
            <span className="method post">POST</span><code>/api/messages</code>
          </div>
          <p>Send a message to a printer. Supports plain text, image upload (multipart), image by URL, and OAuth2-authenticated image URLs.</p>
          <div className="endpoint-auth">🔑 Optional: <code>X-API-Key</code> header — tags message as API source. API and email sources always word-wrap. Web sources respect the <code>word_wrap</code> field.</div>

          <p><strong>Text message</strong></p>
          <pre><code>{`POST /api/messages
Content-Type: application/json

{
  "printer_id":  "uuid",
  "sender_name": "Jane Smith",       // optional — shown in From: header
  "body":        "Hello! 👋",        // supports unicode and emoji
  "word_wrap":   1,                  // 1 = wrap + formatting, 0 = print as typed
  "font_size":   9,                  // 7 · 9 (default) · 12 · 17 · 25
  "align":       "left"              // left · center · right
}`}</code></pre>

          <p><strong>Formatting</strong> (when <code>word_wrap</code> is 1)</p>
          <pre><code>{`# Box    ## Banner    ### Title    #### Subtitle
---      **bold**     __underline__`}</code></pre>

          <p><strong>Image by URL</strong></p>
          <pre><code>{`{
  "printer_id": "uuid",
  "image_url":  "https://example.com/photo.jpg"
}`}</code></pre>

          <p><strong>Image via OAuth2 (e.g. Genesys PureCloud MMS)</strong></p>
          <pre><code>{`{
  "printer_id":          "uuid",
  "image_url":           "https://api-downloads.mypurecloud.com/api/v2/downloads/abc123",
  "oauth_token_url":     "https://login.mypurecloud.com/oauth/token",
  "oauth_client_id":     "your-client-id",
  "oauth_client_secret": "your-client-secret"
}`}</code></pre>

          <p><strong>Image with explicit auth header</strong></p>
          <pre><code>{`{
  "printer_id":    "uuid",
  "image_url":     "https://secure.example.com/image.jpg",
  "image_headers": { "Authorization": "Bearer your-token" }
}`}</code></pre>

          <p><strong>Note:</strong> URLs are fetched server-side and must be public HTTP(S). Localhost, private, link-local, and cloud-metadata addresses are blocked. Set <code>ALLOW_PRIVATE_NETWORK_FETCH=1</code> on the server if you intentionally fetch from a private network.</p>

          <p><strong>Image upload (multipart/form-data)</strong></p>
          <pre><code>{`POST /api/messages
Content-Type: multipart/form-data

printer_id = uuid
image      = <file>`}</code></pre>

          <p><strong>Response</strong></p>
          <pre><code>{'{ "success": true, "message_id": "uuid", "status": "pending" }'}</code></pre>
        </div>

        <div className="endpoint">
          <div className="endpoint-header">
            <span className="method get">GET</span><code>/api/messages/poll</code>
          </div>
          <p>Fetch and claim all pending messages for this printer. Used by the print client. Marks claimed messages as <code>printing</code>.</p>
          <div className="endpoint-auth">🔑 Requires <code>X-API-Key</code> header. Optional <code>X-Client-Version</code> header.</div>
          <pre><code>{`{
  "printer_id": "uuid",
  "print_width_dots": 384,
  "emoji_mode": "glyph",               // glyph | text
  "messages": [
    {
      "id":           "uuid",
      "body":         "Hello!",
      "image_path":   "filename.jpg",   // null if text-only
      "sender_name":  "Jane",
      "word_wrap":    1,
      "font_size":    9,
      "align":        null,             // null | center | right
      "kind":         null,             // null | test_page
      "source":       "web",            // web | api | email
      "created_at":   "2026-05-06T12:00:00"
    }
  ]
}`}</code></pre>
        </div>

        <div className="endpoint">
          <div className="endpoint-header">
            <span className="method patch">PATCH</span><code>/api/messages/:id</code>
          </div>
          <p>Report the print result back to the server. Called by the print client after each job.</p>
          <div className="endpoint-auth">🔑 Requires <code>X-API-Key</code> header.</div>
          <pre><code>{`{ "status": "printed" }
// or on failure:
{ "status": "failed", "error": "Printer offline" }`}</code></pre>
        </div>

        <div className="endpoint">
          <div className="endpoint-header">
            <span className="method post">POST</span><code>/api/printers</code>
          </div>
          <p>Register a new printer. Returns a one-time API key — save it immediately.</p>
          <pre><code>{`{
  "name":        "Front Desk",
  "description": "58mm thermal",   // optional
  "location":    "Lobby",          // optional
  "print_width_dots": 384          // optional: 384 / 512 / 576
}

// Response:
{ "success": true, "api_key": "uuid", "printer": { ... } }`}</code></pre>
        </div>

        <div className="endpoint">
          <div className="endpoint-header">
            <span className="method">EMAIL</span><code>smtp://yourserver:2525</code>
          </div>
          <p>Send email to <code>&lt;printer-id&gt;@print.local</code>. The email body and any image attachments are printed. The From address appears as the sender name.</p>
        </div>

        <div className="endpoint">
          <div className="endpoint-header">
            <span className="method get">GET</span><code>/api/printers/:id/stats</code>
          </div>
          <p>Message counts for a printer broken down by status and source.</p>
          <pre><code>{`{
  "stats": {
    "total": 42, "pending": 1, "printed": 40, "failed": 1,
    "from_web": 20, "from_api": 18, "from_email": 4
  }
}`}</code></pre>
        </div>

      </div>
    </section>
  );
}
