# `/transit` → `/rive`

Rive (the GTFS public-transit atlas) is served at **`/rive/`**.

This directory is an apex-authored **200 alias**, not the app. `index.html` and
`watch.html` redirect to the matching `/rive/` URL while preserving query and
hash, so old bookmarks do not 404.

Do not put the atlas here. `publish-transit.yml` rsyncs the published tree into
`rive/` only. A snapshot of the previous `/transit` tree is in `transitA/`.
