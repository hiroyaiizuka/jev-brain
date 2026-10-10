import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APPNAME } from 'src/constants/constants';
import { DEFAULT_SETTINGS } from 'src/Settings';
import en from 'src/lang/locale/en';

// docs/architecture.md D10: what the user sees is JevBrain. Command IDs, CSS classes,
// setting keys and class names stay `excalibrain` and are not checked here.
describe('display name (D10)', () => {
  it('names the app and the default drawing JevBrain', () => {
    expect(APPNAME).toBe('JevBrain');
    expect(DEFAULT_SETTINGS.excalibrainFilepath).toBe('jevbrain.md');
  });

  it('uses JevBrain in the command names', () => {
    expect([en.COMMAND_START, en.COMMAND_START_HOVER, en.COMMAND_START_POPOUT, en.COMMAND_STOP])
      .toEqual(['JevBrain Normal', 'JevBrain Hover-Editor', 'JevBrain Popout Window', 'Stop JevBrain']);
  });

  it('leaves no ExcaliBrain in the strings of any locale', () => {
    // Keys such as EXCALIBRAIN_FILE_NAME are identifiers; only the quoted text reaches the screen.
    const quoted = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/gu;
    const dir = join(process.cwd(), 'src/lang/locale');
    const offenders = readdirSync(dir).flatMap((file) =>
      (readFileSync(join(dir, file), 'utf8').match(quoted) ?? [])
        .filter((text) => /excali ?brain/iu.test(text))
        .map((text) => `${file}: ${text.slice(0, 60)}`));
    expect(offenders).toEqual([]);
  });
});
