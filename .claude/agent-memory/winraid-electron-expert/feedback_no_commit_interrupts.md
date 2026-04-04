---
name: No commit permission interrupts during task execution
description: Never ask for permission to commit mid-task; save the commit for the very end and only run it if the task spec says to commit
type: feedback
---

Never interrupt ongoing task execution by requesting permission to run git commands. When a plan or task spec includes a commit step at the end, run it at that point — do not ask for confirmation.

**Why:** User has explicitly said not to interrupt work asking for commit permissions. It breaks the flow of multi-step plan execution.

**How to apply:** When executing a plan with a commit step, complete all implementation and verification steps first, then run the commit in one shot at the end without seeking permission. If the task spec omits a commit, do not commit at all.
