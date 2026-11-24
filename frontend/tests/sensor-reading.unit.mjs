import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSensorReading } from '../src/utils/sensorReading.js';

for (const [name, input, expected] of [
  ['rejects null', null, null],
  ['rejects an omitted value', undefined, null],
  ['rejects an empty string', '', null],
  ['rejects whitespace', ' \t\n ', null],
  ['rejects a numeric prefix with trailing text', '0oops', null],
  ['rejects booleans', false, null],
  ['rejects arrays', [], null],
  ['rejects NaN', NaN, null],
  ['rejects infinite values', Infinity, null],
  ['rejects overflow in scientific notation', '1e999', null],
  ['preserves a numeric zero', 0, 0],
  ['preserves a string zero', ' 0 ', 0],
  ['preserves a negative numeric reading', -4.25, -4.25],
  ['parses a negative decimal string', ' -4.25 ', -4.25],
  ['parses scientific notation', '2.5e-2', 0.025],
]) {
  test(name, () => assert.equal(parseSensorReading(input), expected));
}
