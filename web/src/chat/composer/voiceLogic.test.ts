import { describe, expect, it } from 'bun:test';
import { voiceEnded } from './voiceLogic';

const base = { error: null, heard: false, ms: 5000, mac: false, stopped: false };
const MAC_TEXT = 'Voice input stopped right away - Allow Microphone and Speech Recognition for AgentView in System Settings > Privacy & Security';

describe('voiceEnded', () => {
  it('says nothing when words were heard', () => {
    expect(voiceEnded({ ...base, heard: true, error: 'network', ms: 100 })).toBe('');
  });

  it('maps each known error code', () => {
    expect(voiceEnded({ ...base, error: 'not-allowed' })).toBe('Microphone blocked. Allow it in the site settings');
    expect(voiceEnded({ ...base, error: 'no-speech' })).toBe('No speech heard');
    expect(voiceEnded({ ...base, error: 'network' })).toBe('Speech service unreachable');
    expect(voiceEnded({ ...base, error: 'audio-capture' })).toBe('No microphone found');
    expect(voiceEnded({ ...base, error: 'language-not-supported' })).toBe('Speech recognition does not support this language');
    expect(voiceEnded({ ...base, error: 'service-not-allowed' })).toBe('Speech recognition is not allowed here');
    expect(voiceEnded({ ...base, error: 'service-not-allowed', mac: true })).toBe('Turn on Dictation in System Settings > Keyboard');
  });

  it('names an unknown code', () => {
    expect(voiceEnded({ ...base, error: 'weird' })).toBe('Voice input failed (weird)');
  });

  it('handles aborted by who stopped it', () => {
    expect(voiceEnded({ ...base, error: 'aborted' })).toBe('Voice input was interrupted');
    expect(voiceEnded({ ...base, error: 'aborted', stopped: true })).toBe('');
  });

  it('puts error rules before the no-error rules', () => {
    expect(voiceEnded({ ...base, error: 'no-speech', ms: 400, stopped: true })).toBe('No speech heard');
  });

  it('handles a short session with no error', () => {
    expect(voiceEnded({ ...base, ms: 400 })).toBe('Voice input stopped right away');
    expect(voiceEnded({ ...base, ms: 400, mac: true })).toBe(MAC_TEXT);
    expect(voiceEnded({ ...base, ms: 400, stopped: true })).toBe('');
  });

  it('says no speech for a long session with no error', () => {
    expect(voiceEnded(base)).toBe('No speech heard');
    expect(voiceEnded({ ...base, stopped: true })).toBe('No speech heard');
  });
});
