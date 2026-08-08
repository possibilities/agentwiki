# 0005 — Refs resolve in tiers, and ambiguity is an error

Every `<ref>` is tried against five tiers in order — exact slug, exact title,
case- and article-insensitive title, unambiguous fuzzy contains, then the
spoken words present in order — and the first tier that matches wins. Two
matches inside one tier is an `ambiguous_ref` error naming the candidates, not
a guess: the caller is often a voice agent, and picking one silently is how a
misheard phrase writes to the wrong document.

The last tier is what makes "the bluetooth trap" find
`bluetooth-q30-hfp-trap`. It requires the words in order, so a rearrangement
resolves to nothing rather than to something plausible.

Wikilinks stop after the normalized tier. A typed `[[…]]` that nearly matches
must surface as dangling — a document's own text is written deliberately, and
fuzzily rewriting an author's link would put edges in the graph nobody wrote.
`resolve` exists so the fuzzy tiers stay available as data instead.
