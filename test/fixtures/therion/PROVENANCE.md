# Therion reference test vectors

`ResurgenceDeLAvenir.lox` (Therion binary) and `ResurgenceDeLAvenir.3d` (the
Survex `.3d` export of the same survey) are a real cave-survey pair, used as a
cross-format oracle: the `.3d` parser is independently validated against
survex's `dump3d`, so asserting the `.lox` parse agrees with the `.3d` parse
(station/leg counts, bounds) anchors `.lox` coordinate decoding to reality.

Source: the Ultima Patagonia survey project,
https://github.com/tr1813/ultima-patagonia-topo (therion/data/304/…). Vendored
solely as small interop test vectors. The cave name in the `.lox`/`.3d` titles
is the survey's own label.
