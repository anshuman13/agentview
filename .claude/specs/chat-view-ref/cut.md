# Chat view controls: keep or cut

Every control in the chat view on web and Android, with a verdict. Nothing is removed yet.
Quote and Remember are already cut and are left out of the table. This branch still has their code:
web text-selection Quote, Android "Quote last reply", "Remember…" in both chat menus and the Remember button in the Memory sheet.

The task checklist, the "N tools ›" button and the claim chips stay, by rule.

## Header

| Control | Where | What it does | Verdict | Reason |
|---|---|---|---|---|
| Chats button (menu icon) | both (phone) | Opens the chat list | keep | Main way back to other chats on a phone. |
| Chat title | both | Shows the title; double-click or long press renames | keep | Rename in place is quick and expected. |
| Started-from link | both | Opens the chat this one was forked from | keep | Only shows when it applies. |
| New chat button | both (phone) | Opens the New chat sheet for this repo | keep | Core action. |
| State button ("Idle · 5m", live status) | web | Opens a dropdown with the running tool and the steps | keep | Shows what Claude is doing right now. |
| Edit next steps, Add a step | web | Edits the plan in the status dropdown and sends it at the next tool call | cut-candidate | Rarely used. Sending a message steers Claude the same way. |
| "N agents ›" or "Run ›" | both | Opens the Agents rail or sheet with run controls | keep | Only route to agent details and the tries board. |
| Chat details menu: Rename | web | Renames the chat | keep | Same as the title, but discoverable. |
| Chat details menu: Review changes | both | Runs /code-review on the working tree | keep | Claude Code has the same review. |
| Chat details menu: "N waiting" | web | Opens the chat list | cut-candidate | Duplicates the sidebar badges. |
| Chat details menu: usage row | web | Shows plan usage and opens the usage view | cut-candidate | Duplicates the status bar usage. |
| Chat details menu: Mac name, advisor and Fable counts | web | Disabled info rows | cut-candidate | Not actions, and rarely read. |

## Chat menu (web chat settings pick, Android chat menu)

| Control | Where | What it does | Verdict | Reason |
|---|---|---|---|---|
| Permission mode | both | Picks Default, Auto, Plan, Supervised and so on | keep | Core setting, like Shift+Tab in Claude Code. |
| Model | both | Picks the model | keep | Core setting, like /model. |
| Effort | both | Picks the effort level | keep | Core setting. |
| Claude account | both | Picks the main or work account | keep | Needed to switch plans. |
| Find in chat | both | Opens the find bar | keep | Used often, also on Cmd+F. |
| Prompts | both | Lists sent prompts; a pick scrolls to one | cut-candidate | Duplicates Find in chat and scrolling. |
| Fork: Side chat | web | Forks the chat into the side column | keep | Like Claude desktop's side chat. |
| Fork: New chat / Fork chat | both | New chat that starts from a summary of this one | cut-candidate | Rarely used. Compaction and @chat cover it. |
| Remind me | both | Adds a Codex task to check the chat later | cut-candidate | Rarely used and no Claude Code equivalent. A Codex task does the same. |
| Copy: Last reply / Copy last reply | both | Copies the latest reply | cut-candidate | Duplicates the Copy button under each reply. |
| Copy: Copy as Markdown | web | Copies the loaded chat as Markdown | cut-candidate | Rarely useful. |
| Share chat | Android | Sends the chat Markdown to the share sheet | cut-candidate | Rarely useful, the phone twin of Copy as Markdown. |
| Continue in terminal | both | Copies the claude --resume command | keep | Direct Claude Code equivalent. |
| Close chat | Android | Stops the chat process | keep | Needed to free a running chat. |
| Archive | Android | Archives the chat | keep | Core list action. |
| Tools: Saved prompts | both | Last 50 prompts sent, tap to reuse | cut-candidate | Duplicates Use again and prompt history. |
| Tools: Images | both | Lists every image the chat read, wrote or got | cut-candidate | Rarely useful. |
| Tools: Dev servers | Android | Lists dev servers on the Mac | cut-candidate | Duplicates the Ops view. |
| Tools: TODOs | both | Lists TODO, FIXME and AI! comments; tap makes a prompt | cut-candidate | Rarely used and no Claude Code equivalent. |
| Tools: Memory | both | Opens the Memory sheet | keep | Like /memory in Claude Code. |
| Tools: Hooks | both | Lists manual prompt hooks; tap queues one | cut-candidate | Rarely used and unlike Claude Code hooks. A saved prompt does the same. |

## Memory sheet

| Control | Where | What it does | Verdict | Reason |
|---|---|---|---|---|
| File row tap and Back | both | Opens a memory or instruction file and goes back | keep | The point of the sheet. |
| Edit | both | Edits the repo instruction file or a memory file | keep | Like /memory editing. |
| Add a rule | both | Appends a line to the repo instruction file | keep | Fast way to add a rule. |
| Forget | both | Deletes a memory file, with Undo | keep | Needed to clean up memory. |
| Move to wiki | both | Turns a memory file into a wiki claim and deletes the file | cut-candidate | Rarely used. Forget plus the wiki covers it. |
| From the wiki section: open, Retire, Open Memory | both | Lists the claims new chats get; opens or retires one | keep | Shows what a new chat starts with. |

## Transcript

| Control | Where | What it does | Verdict | Reason |
|---|---|---|---|---|
| Task checklist ("Tasks · 2 of 5") | both | Shows the turn's set_status tasks | keep | Protected. |
| "Used N tools ›" | both | Opens the turn's tool calls in a tab or screen | keep | Protected. |
| "Used N claims" chip | both | Lists the wiki claims the turn read | keep | Protected claim chip. |
| "Proposed N claims" chip, Review | both | Lists the claims the turn proposed | keep | Protected claim chip. |
| "Remembered N memories" chip | both | Opens the Memory sheet at the file Claude wrote | keep | Shows memory writes that would be hidden otherwise. |
| Prompt hover or long press: Sent time | both | Shows when the prompt was sent | keep | Small and useful. |
| Prompt hover or long press: Use again | both | Puts the prompt back in the composer | keep | Like editing a past prompt in Claude Code. |
| Prompt hover or long press: Copy | both | Copies the prompt text | cut-candidate | Rarely useful. Use again covers it. |
| Send now (queued prompt) | both | Stops the current step and sends the queued prompt | keep | Needed while Claude runs. |
| Reply Copy | both | Copies the turn's last reply | keep | Used often. |
| Rewind files | both | Puts the files back to before the prompt | keep | Like /rewind in Claude Code. |
| Code block Copy | both | Copies the code | keep | Used often. |
| Code block Run in terminal | both | Types a one-line command into the terminal | cut-candidate | Duplicates a ! prompt and Copy. |
| File card right-click or long press | both | Copy path menu | keep | Cheap and useful. |
| Doc and sketch card Open | both | Opens the file or sketch | keep | Only way to see the result. |
| Agent box header and Stop | both | Expands the subagent; stops a running one | keep | Needed to follow and stop agents. |
| Explored group header | both | Expands the folded Read, Grep and Glob steps | keep | Keeps the transcript short. |
| Show earlier | both | Loads earlier events | keep | Needed for long chats. |
| New line | both | Marks unread replies | keep | Not a control, no clutter. |
| Retry, Resume end lines | both | Retries a failed turn; continues a stalled one | keep | Needed recovery. |
| Jump to latest | both | Scrolls to the end with a new-replies count | keep | Needed when scrolled up. |
| Find bar: Previous, Next, Close, Load earlier | both | Moves between find hits | keep | Part of Find in chat. |

## Cards above the composer

| Control | Where | What it does | Verdict | Reason |
|---|---|---|---|---|
| Permission card buttons | both | Allow, deny, always allow | keep | Core. |
| Question card options and Other | both | Answers Claude's question | keep | Core. |
| Plan approval card and paragraph comments | both | Approves or keeps planning with comments | keep | Core to Plan mode. |
| Review N changes card: Keep, Undo per hunk and file, Keep all | both | Supervised review of the turn's edits | keep | Only way to use Supervised. |

## Composer

| Control | Where | What it does | Verdict | Reason |
|---|---|---|---|---|
| Settings chip (model · effort · mode) | both | Opens the chat menu | keep | Main entry to settings. |
| + Add menu or sheet | both (phone) | Add files, MCP server, chat settings | keep | Groups the phone actions. |
| Add files / Choose file | both | Uploads files | keep | Core. |
| Photo, Take photo | Android | Picks or takes a photo | keep | Main phone use for attachments. |
| Context % row (tap to compact) | Android | Shows context use and runs /compact | keep | Like /compact. |
| Use an MCP server button and its chips | both | Asks Claude to use a chosen MCP server or tool | cut-candidate | No Claude Code equivalent. Naming the tool in the prompt does the same. |
| Attachment chips | both | Show and remove pending uploads | keep | Needed to see what is attached. |
| Quick reply chips | both | Send a suggested answer to Claude's question | keep | Saves typing on the phone. |
| Ghost suggestion and Tab | both | Completes the prompt | keep | Like Claude Code prompt suggestions. |
| @ files, / commands, @chat: popup | both | Inserts files, commands, chat links | keep | Like Claude Code. |
| Dictate mic | both | Speech to text into the field | keep | Used on the phone. |
| Talk button and voice mode (Done, Pause, Resume) | both | Speaks a prompt and sends it | keep | Main hands-free use on the phone. |
| Send, Stop, hold to stop and send | both | Sends, interrupts, or interrupts and sends | keep | Core. |
