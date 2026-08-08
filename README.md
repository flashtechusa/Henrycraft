# Henrycraft

Custom Henry Minecraft style game.

## Play it

**https://flashtechusa.github.io/Henrycraft/**

That's the link to send to Henry. It works on any computer or tablet with a
browser &mdash; nothing to install.

## One-time setup (do this once)

The link above only works after GitHub Pages is switched on. It takes one click
and only the repo owner can do it:

1. Go to **Settings** &rarr; **Pages** (left sidebar).
2. Under **Build and deployment** &rarr; **Source**, choose **Deploy from a branch**.
3. Set **Branch** to `main` and the folder to `/ (root)`, then click **Save**.

Wait a minute or two, then open the play link. After this, it stays on forever.

## Making changes

The whole game is one file: [`index.html`](index.html) at the root of this repo.

1. Click `index.html` above.
2. Click the pencil icon to edit.
3. Make the change, then click **Commit changes**.
4. Wait about a minute and refresh the play link.

Every commit to `main` republishes the site automatically. If the page looks
stale, do a hard refresh: `Ctrl+Shift+R` on Windows, `Cmd+Shift+R` on a Mac.

## Important: what to put in index.html

`index.html` must contain the game's real **source code** &mdash; the file that
starts with `<!DOCTYPE html>` and has `<style>` and `<script>` tags inside it.

If you open the game in a browser, select the page, and copy it, you only get the
*words you can see*; all the code that makes it work is left behind. To get the
real thing:

- **Best:** open the game file in a text editor (Notepad, TextEdit, VS Code),
  select all, copy.
- **In a browser:** press `Ctrl+U` (Windows) or `Cmd+Option+U` (Mac) to show the
  page source, then select all and copy from there.

A working game of this kind is usually tens of thousands of characters. If what
you pasted is only a few hundred, it's the text and not the code.
