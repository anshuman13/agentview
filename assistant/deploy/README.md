# Assistant Launch Configuration

This directory contains launchd job definitions for running the assistant API and its backup job.

## Installation

These files have been written but not loaded. To activate them:

1. Create the assistant directory:
   ```bash
   mkdir -p ~/.agentview/assistant
   ```

2. Copy the plist files to ~/Library/LaunchAgents:
   ```bash
   cp no.pradhan.assistant.plist ~/Library/LaunchAgents/
   cp no.pradhan.assistant.backup.plist ~/Library/LaunchAgents/
   ```

3. Load both jobs:
   ```bash
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/no.pradhan.assistant.plist
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/no.pradhan.assistant.backup.plist
   ```

4. Verify the API is running:
   ```bash
   curl localhost:7790/health
   ```

## Access

There are no keys. The API answers only this Mac and the peers in `netbird status`, and knows each device by its
NetBird name. To cut a device off, remove it in the NetBird dashboard.

## Unloading

To stop the services:
```bash
launchctl bootout gui/$(id -u) no.pradhan.assistant
launchctl bootout gui/$(id -u) no.pradhan.assistant.backup
```
