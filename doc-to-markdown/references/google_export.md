# Converting Google Docs, Sheets, and Slides

Google Workspace files aren't local files, so there's nothing to convert until
you've pulled a copy down. Use the Claude in Chrome tools to open the file in
an authenticated browser session and export it to the equivalent Office
format — from there it flows through the normal docx/pdf/pptx/xlsx pipeline.

This route (rather than guessing at an export URL) matters because many RFP-
style documents are shared with restricted access ("anyone at this domain" or
named individuals), and only a logged-in browser session can actually reach
them.

## Steps

1. **Load the browser tools** if not already available:
   `ToolSearch` with query `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_create_mcp`

2. **Navigate to the sharing URL** the user gave you. Wait for it to load fully
   — Google Workspace apps are slow to render and export menus won't be
   present in the DOM until the editor has finished loading.

3. **Trigger File → Download** in the app's menu, choosing the closest Office
   equivalent:
   - Google Docs → Microsoft Word (.docx)
   - Google Sheets → Microsoft Excel (.xlsx)
   - Google Slides → Microsoft PowerPoint (.pptx)

   Use the `computer` tool to click through the menu (File → Download → format),
   rather than typing a keyboard shortcut, since shortcuts vary by OS and
   browser focus state.

4. **Locate the downloaded file.** Chrome downloads to the browser's default
   download directory; ask the user where that is if you can't find it, or
   check the most common locations (`~/Downloads` on macOS/Linux). Confirm the
   filename before proceeding — Google appends the doc title, which may not
   match what the user called it.

5. **Hand off to the matching converter** (`convert_docx.py`, `convert_xlsx.py`,
   or `convert_pptx.py`) exactly as you would for a file the user uploaded
   directly.

## If the export menu doesn't appear

- The user may not be logged into the Google account that owns/can-view the
  file in that Chrome profile. Ask them to confirm they're signed in, or to
  share the file more broadly, rather than guessing.
- Comment-only or view-only access still allows downloading in most cases —
  don't assume a lack of edit access is the blocker.
- If the file is a Google Sheet with multiple tabs the user only wants some
  of, download the whole thing — `convert_xlsx.py` converts every sheet, and
  you can trim sections out of the resulting Markdown afterward if asked.
