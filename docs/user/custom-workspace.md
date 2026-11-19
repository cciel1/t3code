# T3 Code Workspace

This fork adds a six-pane chat workspace, separate chat windows, provider quota rings, and a saved workspace on desktop and web.

## Run on Linux x86-64

Download the Linux archive from the [fork releases](https://github.com/cciel1/t3code/releases). Extract it and run:

```bash
cd T3-Code-Workspace
./run-t3-code
```

The launcher uses its own T3 home, Electron profile, and local port so you can try it beside an existing T3 installation. Connect your provider accounts from **Settings → Providers**. The archive contains the app and its runtime.

## Use the workspace

- Choose **Open to the side** from a chat's sidebar menu to create a pane. Choose **Open in new window** to keep a chat in a separate desktop window.
- Drop one chat onto a pane's tab strip to group it with the other chats there. Drag a grouped tab out to the pane body to split it out. New threads appear in the selected pane when a split or tab group is open.
- Select a tab to switch chats. Use the arrow keys when a tab has keyboard focus. Each tab has a close button.
- Reopening the app on the same profile restores the main window's last panes, tab order, and selections. Separate chat windows keep their layouts independent.
- Imported Codex, Claude, and Pi chats show an **Update conversation from original session** button in the chat header. It reads the matching local session and adds newly written messages. If the original history no longer matches the imported chat, it reports the mismatch and preserves the chat.

The Linux x86-64 build was verified on Pop!_OS. See the upstream [build and development guide](../operations/development.md) for building from the branch on other platforms.
