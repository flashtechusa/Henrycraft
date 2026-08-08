# Henrycraft

Custom Henry Minecraft style game.

## Play it

**https://flashtechusa.github.io/Henrycraft/**

That link is the one to send to Henry. It works on any computer or tablet with a
browser &mdash; nothing to install.

## How hosting works

The whole game is one file, `index.html`, at the root of this repo.

Every time `index.html` changes on the `main` branch, the workflow in
`.github/workflows/deploy-pages.yml` republishes the site automatically. There is
nothing to click after a change &mdash; give it about a minute and refresh the
page. (A hard refresh, `Ctrl+Shift+R` or `Cmd+Shift+R`, helps if the browser is
holding on to the old version.)

## Editing the game

1. Open [`index.html`](index.html) here on GitHub.
2. Click the pencil icon to edit it.
3. Make the change and click **Commit changes**.
4. Wait about a minute, then refresh the play link.

To see how a deploy is going, open the **Actions** tab.

### One important note about editing

`index.html` must contain the game's real **source code** &mdash; the file that
starts with `<!DOCTYPE html>` and contains the `<style>` and `<script>` tags.

If you open the game in a browser, select the page and copy it, you only get the
*words you can see* &mdash; the code that makes it work gets left behind. To get
the real thing: open the game file in a text editor (Notepad, TextEdit, VS Code)
and copy everything from there. In a browser, `Ctrl+U` / `Cmd+Option+U` shows the
real source.
