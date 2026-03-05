# Buffer Replacement

## MODIFIED Requirements

### Requirement: Use Uint8Array Instead of Buffer
The system SHALL use `Uint8Array` instead of Node.js `Buffer` for all binary data operations.

#### Scenario: Allocating zero-filled buffers
- **WHEN** code needs a zero-filled byte array (previously `Buffer.alloc(n)`)
- **THEN** it uses `new Uint8Array(n)`

#### Scenario: Creating buffers from arrays
- **WHEN** code creates a buffer from an array (previously `Buffer.from(arr)` or `new Buffer(arr)`)
- **THEN** it uses `new Uint8Array(arr)` or `Uint8Array.from(arr)`

#### Scenario: Searching for byte sequences
- **WHEN** code searches for a byte sequence (previously `buf.indexOf(Buffer.from([...]))`)
- **THEN** it uses a `findBytes(haystack: Uint8Array, needle: number[])` helper function

#### Scenario: Affected files
- **WHEN** the migration is complete
- **THEN** no file in `src/` imports or references `Buffer` (except possibly a polyfill import for `c64jasm`)
