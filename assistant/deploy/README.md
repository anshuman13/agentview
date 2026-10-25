# Assistant Launch Configuration

This directory contains launchd job definitions for running the assistant API and its backup job.

## Installation

These files have been written but not loaded. To activate them:

1. Create the assistant directory:
   ```bash
   mkdir -p ~/.agentview/assistant
   ```

2. Create the devices configuration with a random key:
   ```bash
   KEY=$(openssl rand -hex 24)
   echo "{\"phone\":\"$KEY\"}" > ~/.agentview/assistant/devices.json
   chmod 600 ~/.agentview/assistant/devices.json
   ```

3. Copy the plist files to ~/Library/LaunchAgents:
   ```bash
   cp no.pradhan.assistant.plist ~/Library/LaunchAgents/
   cp no.pradhan.assistant.backup.plist ~/Library/LaunchAgents/
   ```

4. Load both jobs:
   ```bash
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/no.pradhan.assistant.plist
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/no.pradhan.assistant.backup.plist
   ```

5. Verify the API is running:
   ```bash
   curl localhost:7790/health
   ```

## Unloading

To stop the services:
```bash
launchctl bootout gui/$(id -u) no.pradhan.assistant
launchctl bootout gui/$(id -u) no.pradhan.assistant.backup
```
