# Content policy

Every asset in Prop Commons is released under CC0 1.0 and may be used by anyone for anything. This
policy says what assets may contain so that promise holds. Reviewers enforce it; no automated check
can. The sign-off statement on every pull request confirms it.

## Every asset must

- **Be yours to release.** You made it, or you have the right to release every part of it under
  CC0: the mesh, every texture, any scan, and any AI tool output. Textures from sites that forbid
  redistribution, or scans of things someone else owns the design of, are not allowed.
- **Be honest about how it was made.** Set `ai_assisted` to `true` if any AI tool made or changed
  any part of it, and list the tools in `tools`. AI-assisted work is welcome; hiding it is not.
- **Credit the people who made it**, in `credits`, even though CC0 doesn't require it.

## No asset may contain

- **Real brands or logos**: no trademarks, product names or packaging designs, real or lightly
  disguised.
- **Recognisable characters** from existing works: films, games, books, comics, toys.
- **Likenesses of real people.**
- **Anything sexual or hateful**, including hate symbols.
- **Copies of other people's work**, including assets from other libraries, unless they are CC0
  themselves and credited as such.

Ordinary designs are fine: a generic mug, a plain chair, a common fruit, a public-domain object.

## Takedowns

- **To report an asset**, open a [Report a problem](https://github.com/Propcommons/propcommons/issues/new/choose)
  issue. For anything sensitive (for example, your own likeness or work), use private reporting
  instead, as described in [SECURITY.md](SECURITY.md).
- **A maintainer reviews the report.** If the asset breaks this policy, the maintainer replaces the
  version folder's contents with a `tombstone.json` giving the reason, the date and who did it.
  The site then shows the version as taken down. Compositions that pin it stay published but
  leave that item out, and their author can publish a new version without it.
- **IDs and version numbers are never reused**, so a taken-down version can't be confused with a
  later one.
- Copies already downloaded under CC0 can't be recalled; a takedown removes the asset from this
  library.

## Quality is separate

Low quality isn't a policy violation. Reviewers may ask for changes so an asset fits the kit, but
that is review, covered in [CONTRIBUTING.md](CONTRIBUTING.md) and the spec's guidance section.
