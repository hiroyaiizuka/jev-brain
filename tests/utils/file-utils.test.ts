import { describe, expect, it } from 'vitest';
import { getFilenameFromPath, splitFolderAndFilename } from 'src/utils/fileUtils';

describe('getFilenameFromPath', () => {
  it('drops the folder and the .md extension of a note', () => {
    expect(getFilenameFromPath('Books/Foundation.md')).toBe('Foundation');
  });

  it('keeps the extension of an attachment and a name without a folder', () => {
    expect(getFilenameFromPath('Attachments/cover.png')).toBe('cover.png');
    expect(getFilenameFromPath('Foundation.md')).toBe('Foundation');
  });
});

describe('splitFolderAndFilename', () => {
  it('splits a nested path into folder, filename and basename', () => {
    expect(splitFolderAndFilename('Books/Asimov/Foundation.md')).toEqual({
      folderpath: 'Books/Asimov',
      filename: 'Foundation.md',
      basename: 'Foundation',
    });
  });

  it('puts a top-level file in the root folder', () => {
    expect(splitFolderAndFilename('Foundation.md')).toEqual({
      folderpath: '/',
      filename: 'Foundation.md',
      basename: 'Foundation',
    });
  });

  it('only strips the last extension', () => {
    expect(splitFolderAndFilename('Drawings/brain.excalidraw.md').basename).toBe('brain.excalidraw');
  });
});
