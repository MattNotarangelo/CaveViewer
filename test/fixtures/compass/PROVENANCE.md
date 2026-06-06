# Compass reference test vectors

These are **reference interop test vectors** vendored from the Survex project's
test suite. Each `.plt` is a genuine Compass Plot file; the matching `.dump` is
Survex's own decode of it (Survex reads the `.plt`, `dump3d` prints the result).

| File | Source |
|------|--------|
| `multisurvey.plt` / `.dump` | https://github.com/ojwb/survex/blob/master/tests/multisurvey.plt |
| `multisection.plt` / `.dump` | https://github.com/ojwb/survex/blob/master/tests/multisection.plt |
| `pre1970.plt` / `.dump` | https://github.com/ojwb/survex/blob/master/tests/pre1970.plt |

`multisurvey.dump` is the primary oracle for `compassPlt.golden.test.ts`: it is a
faithful 1:1 decode (two surveys, stations, legs, splays, LRUD), so our parser is
checked against Survex's reading of the exact same bytes — not against our own
encoder. (`filter.plt`'s dump is intentionally a *filtered* subset, so it is not
suitable as a 1:1 oracle and is not used.)

Survex is distributed under the GNU GPL v2+. These small factual data files are
included solely as test vectors. See https://survex.com/ for the full project and
license.
