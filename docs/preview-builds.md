# How test builds work

- **main** builds the "Latest build" download.
- **preview-build** builds the "Preview build" download. It is the one shared branch for testing.
- **Every other branch** builds as a check only. It never replaces a download.

To get a feature into the Preview download:

1. Work on your own branch, based on the latest `preview-build`.
2. When it's ready to test, merge your branch into `preview-build` (a normal merge, never a force push or reset).
3. Push `preview-build`. The build publishes the Preview download.

## The gatekeeper

Before a build replaces a download, it checks that its code contains the commit the
current download was built from. If anything would be lost, the build stops with
"Blocked" and lists the missing commits. Fix it by merging those commits in.

To undo a bad build on purpose, run the workflow by hand from the Actions tab with
"Let this build replace a download it doesn't contain" ticked.

The Google TV app has its own workflow (`tv.yml`) and its own `tv-preview` download.
