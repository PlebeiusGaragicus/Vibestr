# README

This web app uses HTML with Javascript and CSS.  Also, ensure it works as a Progressive Web App.  It will store information using cookies and localStorage.

This project will be hosted with Github Pages out of the `docs/` folder.

IMPORTANT: DO not start a server to run this project in order to test it - the USER will run and test the code and provide feedback and bug reports.

---

Let's build a simple Nostr client.  The purpose of which is to subscribe to a new npubs and stay up-to-date with their latest posts.  This will require use of a Nostr MCP to stay up-to-date with nostr protocol/conventions.  Our default relay will be `wss://relay.damus.io`.

We will use localStorage to keep loaded posts and purge old posts when more space is needed for new posts.

The user will NOT have an nsec/npriv or an account.  The purpose is SIMPLY to browser select nostr accounts.

Let's ensure we build a mobile-friendly interface and responsive layout.

In expanded (tablet/desktop) we should use a hamburger menu on a top navbar with an expanding left panel.  In collapsed (mobile) we should use a bottom sheet menu.

When a user scrolls and views a post - let's "hide it" from the list of posts.  We should have a menu to see "past" posts again (anything in localStorage).  But the goal will be "inbox zero."

The app should NOT load new posts when it is opened.  On mobile let's use a "pull down" to refresh feature.  On desktop let's use a "refresh" button once scrolled to the bottom of the feed.

Let's have an option to "favorite" posts.  These posts will NEVER be purged from localStorage.  Let's have a storage management feature which will show how much data is in localStorage and how much is left avaialble (I'm not sure how iOS/android manage PWA localStorage).  We also need an option to "nuke" storage and wipe everything.  The npubs we're following should be held in cookies - a seperate option will be needed to "nuke follow list".

Let's include a camera QR scanner to easily add npubs.

Color scheme should be purple and default theme should be OLED dark.