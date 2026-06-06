# Survex reference test vectors

These two files are **reference interop test vectors** vendored from the Survex
project's own test suite, used here to validate the `.3d` parser against genuine
`cavern`/`dump3d` output (not against our own encoder, which would be circular).

| File | Source |
|------|--------|
| `dump3ddate.3d` / `.dump` | https://github.com/ojwb/survex/blob/master/tests/dump3ddate.3d |

`dump3ddate.3d` is a real **v8** file written by `cavern`. `dump3ddate.dump` is the
human-readable decode produced by Survex's own `dump3d` tool — the ground-truth
oracle for station/leg coordinates, labels, and dates. It exercises the DATE
opcodes, the label delta scheme, MOVE/LINE/LABEL, and the v8 header/flags.

Survex is distributed under the GNU GPL v2+. These small factual data files are
included solely as test vectors. See https://survex.com/ for the full project and
license. If their inclusion is undesirable, remove this directory and the
`survex3d.golden.test.ts` test; the remaining tests use a from-spec encoder.
