import { cloneBoard, createBoard, createLifeStepper } from './life.js';
import {
  GATE_ARITY, MAX_OUTPUTS, describeTree, gateNode, inputNode, isGateNode, isInputNode, normalizeCircuitSpec, treeToChain,
  validateCircuitSpecShape,
} from './circuit-spec.js';

const GATE_ORIGIN = Object.freeze({ x: 480, y: 20 });
const INPUT_PACKET_EAST = '$5bo2bo$9bo$5bo3bo$6b4o!';
const INPUT_PACKET_NORTH = '2b3o$bo2bo$4bo$4bo$bobo!';

const RAW_RLE = Object.freeze({
  and: 'bzU3JDQ3YjJvJDQ4Ym8kNDhib2JvJDQ5YjJvJDUyYjJvJDUyYm9ibyQ1MmJvOCRvMiRvJGJvMiQ2N2IybyQ2N2JvYm8kCjY3Ym8xMyQ4MmIybyQ4MmJvYm8kODJibzEzJDk3YjJvJDk3Ym9ibyQ5N2JvMiQ4NmIybyQ4NWJvMmJvJDg4Ym8kODhibyQKODZib2JvMTFibzNiM28kODZib2JvMTFiMm8yYm8kODdibzExYm9ibzNibzMkODRiMm8zYjJvJDg0Ym81Ym8yMWJvMmJvCjhibyQxMTJibzEwYm9ibyQ4NWJvM2JvMmIybzE0Ym8yYm8zYjJvNWJvM2IybyQ4NmIzbzRiMm8xMGI0bzNiMm9ib2JvNGIKbzNiMm8zYjJvJDkyYm8xMWI0bzE0Ym8zYjJvM2IybyQ5N2IybzVibzJibzhiMm81Ym9ibyQ5N2IybzViNG8xNmJvJAoxMDViNG8kMTA4Ym8yJDg5Ym8kODdiMm9iMm8yJDg2Ym81Ym8yJDg2YjJvYm9iMm85JDg4YjJvJDg4YjJvIQo=',
  or: 'bzUyJDgzYjJvJDgzYm8yYm8kODdibzlib2JvJDcxYm8xNWJvN2JvM2JvJDY4YjRvMTVibzdibyQ1OWJvN2I0bzEyYm8yYgpvN2JvNGJvOGIybyQ1OGJvYm82Ym8yYm8xMmIybzEwYm8xMmIybyQ1N2JvM2IybzRiNG8yNGJvM2JvJDQzYm8yYjJvOWJvCjNiMm81YjRvMTRib2JvOGJvYm8kNDFiM28yYjJvOWJvM2IybzhibzE0YjJvJDQwYm8xN2JvYm8yNmJvJDQwYjJvMTdibwozMWIybzliMm8kMjdiMm8zOWJvYm8xOWJvMmJvN2JvMmJvJDI4Ym80MGIybzE5YjNvOWIzbyQyOGJvYm8zOGJvMjNiOW8kCjI5YjJvNDlibzExYm8yYjVvMmJvJDM3YjJvMzliMm8xMmIybzJiM28yYjJvJDM2Ym8yYm8zOWIybyQzN2IybyRvNzVibwoxM2JvMmJvMjZibzJibzI2Ym8kNzdiMm8xNWJvMjlibyRvNzViMm8xMmJvM2JvMjVibzNibzI1Ym8kYm83OGIzbzhiNG8KMjZiNG8yNmJvJDQwYjJvNDBibyQ0MGJvMzBibzlibyQ0MWIzbzI2Ym9ibyQ0M2JvMTRiMm8xMGIyb2JvOGJvYm8kMzZiCjJvYm8xOGIybzEwYjJvYjJvNmJvMmJvJDI3YjJvM2IybzJiMm9iM28yOGIyb2JvNmIybzEwYjJvJDI3Ym8yYm8yYm84Ym8KMjdib2JvNWIybzNibzhiMm8kMjhiNW8zYjJvYjNvMjlibzhiMm81YjJvJDM3Ym9ibzQxYm8yYm80Ym8kMzBiMm9ibzNibwpibzQyYm9ibyQzMGJvYjJvNGJvOSQ0MWIybyQzOWJvMmJvNDJiMm8kODRib2JvJDM4Ym80N2JvMiQzOWIybyQxOGIybwoyMWJvMTRibyQxOGIybzM2YjNvJDU5Ym8kMzhiMm8zYjJvMTNiMm8kMzhiMm8zYjJvJDM5YjVvJDQwYm9ibzIkNDBiM28KMiQxOGIzbzQ5YjJvJDE3Ym8zYm80N2JvYm8kMTZibzVibzQ4Ym8xNGIybyQxNmJvNWJvNjNib2JvJDE5Ym8xOGJvNDlibwokMTdibzNibzE1Ym81MGIybyQxOGIzbzE2YjNvJDE5Ym8yM2JvJDQyYjNvJDQxYjVvJDE2YjNvMjFiMm8zYjJvJDE2YjNvCjlib2JvMzdiMm8xNWIybyQxNWJvM2JvOGJvYm8zNGJvM2JvMTVibyQyM2JvYm8zYm8zNGJvYm8yYm9ibzExYm9ibyQxNGIKMm8zYjJvM2IybzE2YjNvMTlib2JvM2IybzExYjJvJDI0Ym8xN2IzbzEwYjJvNWIzb2IybzlibyQ1NGJvYm80Ym8xNGJvYgpvJDU2Ym81YjNvYjJvOGJvYm8kNDNiMm8xOWJvYjJvOWJvJDQzYjJvMiQ2MWIybzJiMm8kNjFibzJib2JvJDYyYm9ibyQKMTZiMm80M2Iyb2IybzEzYjJvJDE2YjJvNDZibzE0Ym8kNjRib2JvMTNiM28kNThiMm81YjJvMTVibyQzOGJvYm8xN2JvJAozOWIybzZiMm83Ym9ibyQzOWJvN2JvYm82YjJvJDQyYjJvNGIzbyQ0MWJvMmJvNGIzbyQ0M2JvNGIzbyQzOWJvN2JvYm8kCjM4Ym9iMm81YjJvJDM4Ym8kMzdiMm8hCg==',
  not: 'bzQ5JDMwYm8kMjhiNG8kMTliMm81YjRvYjJvOWIybyQxN2JvMmJvM2JvM2Iyb2IzbzhiMm80MGIybyQ4YjJvNmJvN2JvCjNiMm9iMm80OWJvM2JvJDhiMm82Ym82Ym8zYjVvNDlibzVibzEzYjJvJDE2Ym83YjNvM2JvNDJiMm81Ym8yYm8zYm8xM2IKMm80YjNvJDE3Ym8yYm81MGJvMmJvMTJibzEwYjJvNmI1bzIyYm8kMTliMm8zN2JvYm85Ym83Ym83Ym8xMGIzbzVibzNibwpibzE5YjNvJDU4Ym8zYm83Ym82Ym80Ym9iMm8xMmIybzZibzNiMm8xOGJvJDMyYm8yOWJvN2JvN2Iybzlib2JvOWIybwoyN2IybyQzM2IybzEzYjJvOGJvNGJvN2JvMmJvMTRiMm8xMGIybyQzMmIybzE0YjJvMTJibzEwYjJvMTVibyQ1OGJvM2JvCiQ1OGJvYm84Ym9ibzIxYjJvOWIybyQ3MGIybzIwYm8yYm83Ym8yYm8kNzBibzIxYjNvOWIzbyQ4M2JvMTFiOW8kMzlib2IKbzM5YjJvMTFibzJiNW8yYm8kNDBiMm80MGIybzEwYjJvMmIzbzJiMm8kNDBibyQ3N2JvJG83N2IybzEwYm8yYm8yNmJvCjJibyQ3N2IybzE1Ym8yOWJvJG84OWJvM2JvMjVibzNibyRibzQ1Ym80M2I0bzI2YjRvJDQ4YjJvMzFiM28kNDdiMm8yMWIKbzEyYm8kNzBiNG84Ym8kNjBiMm85YjRvMTBiMm8kNjBiMm85Ym8yYm85Ym9ibyQ2NWJvNWI0bzhiM280YjJvYjNvJDY1YgpvNGI0bzhiM280Ym8yYjRvJDU0Ym9ibzEzYm8xMmIzbzRiMm8kNTViMm8yN2JvYm8kNTVibzI5YjJvNSQ2MmJvJDYzYjJvCiQ2MmIybzYkNjlib2JvJDcwYjJvJDcwYm81JDc3Ym8kNzhiMm8kNzdiMm8xMCQ3MmIybyQ3M2IybyQ3MmJvJDYxYjJvJAo2MGJvM2JvMjhiMm8kNTlibzVibzdibzE5Ym9ibyQ0OWIybzhibzNib2IybzRib2JvMjFibyQ0OWIybzhibzVibzNiMm8KMjRiMm8kNjBibzNibzRiMm8xMmIybyQ2MWIybzZiMm8xMmIybyQ3MWJvYm8kNzNibyEK',
  halfAdder: 'bzIzJDEwMWIybyQxMDFiMm81JDc4YjJvJDc4YjJvMiQxMDBiM28kOTlibzNibyQ3OWJvMThibzVibyQ3OGJvYm8xN2Iybwpib2IybyQ3N2JvM2JvJDc4YjNvJDc2YjJvM2IybzE4Ym8kMTAwYm9ibyQxMDBib2JvJDEwMWIybyQxMDNibyQ3N2JvMjRiCjNvJDc3Ym8yM2JvM2JvJDc3Ym9iM28xOGJvYjNvYm8kOTZibzRiNW8kODJibzExYjJvJDc5Ym9iMm8xMmIybyQ3OWIybwozJDc0YjJvM2IybzdibzExNGIybyQ3NGIybzNiMm83YjJvMTEzYm8yYm8kNzViNW82Ym9ib2JvMTE2Ym85Ym9ibyQ3NmJvCmJvNWIzbzJiMm8xMDBibzE1Ym83Ym8zYm8kMTg4YjRvMTVibzdibyQ3NmIzbzI0YjJvNzRibzdiNG8xMmJvMmJvN2JvNGIKbzhiMm8kMTAzYjJvNzNib2JvNmJvMmJvMTJiMm8xMGJvMTJiMm8kMTc3Ym8zYjJvNGI0bzI0Ym8zYm8kMTYzYm8yYjJvCjlibzNiMm81YjRvMTRib2JvOGJvYm8kMTYxYjNvMmIybzlibzNiMm84Ym8xNGIybyQ5NWJvNjRibzE3Ym9ibzI2Ym8kCjc2YjJvMTVib2JvNjRiMm8xN2JvMzFiMm85YjJvJDc2YjJvMTZiMm81MWIybzM5Ym9ibzE5Ym8yYm83Ym8yYm8kMTQ4Ym8KNDBiMm8xOWIzbzliM28kMTQ4Ym9ibzM4Ym8yM2I5byQxNDliMm80OWJvMTFibzJiNW8yYm8kMTU3YjJvMzliMm8xMmIybwoyYjNvMmIybyQxNTZibzJibzM5YjJvJDE1N2IybyRvMjlibzJibzI2Ym8yYm8yNmJvMmJvMjZibzJibzI2Ym8yYm80MmJvCjEzYm8yYm8yNmJvMmJvMjZibzJibzI2Ym8kMzRibzI5Ym8yOWJvMjlibzI5Ym80MmIybzE1Ym8yOWJvMjlibyRvMjlibwozYm8yNWJvM2JvMjVibzNibzI1Ym8zYm8yNWJvM2JvNDFiMm8xMmJvM2JvMjVibzNibzI1Ym8zYm8yNWJvJGJvMjliNG8KMjZiNG8yNmI0bzI2YjRvMjZiNG80NWIzbzhiNG8yNmI0bzI2YjRvMjZibyQxNjBiMm80MGJvJDE2MGJvMzBibzlibyQKMTEwYm81MGIzbzhibzE3Ym9ibyQxMDhib2JvNTJibzlibzRiMm8xMGIyb2JvOGJvYm8kMTA5YjJvNDViMm9ibzExYjNvCjRiMm8xMGIyb2IybzZibzJibyQxNDdiMm8zYjJvMmIyb2IzbzI4YjJvYm82YjJvMTBiMm8kMTQ3Ym8yYm8yYm84Ym8yN2IKb2JvNWIybzNibzhiMm8zMmJvJDE0OGI1bzNiMm9iM28yOWJvOGIybzViMm8zN2IzbyQxNTdib2JvNDFibzJibzRibzM5YgpvJDE1MGIyb2JvM2JvYm80MmJvYm80M2IybyQxNTBib2IybzRibzMkMjUxYm8kMjUwYjNvJDI1MGIzbzIkMTI1Ym82MWJvCjYwYjJvM2IybyQxMjNib2JvNjJibzU5YjJvM2IybyQxMjRiMm82MGIzbyQyMDViMm8kMjA0Ym9ibyQyMDZibzQzYjJvMiQKMjQ4YjJvJDI0OGIybzNiMm8kMjQ3Ym9ibzNibyQyNTRiM28kMjU2Ym80JDE0MGJvNjFibyQxMzhib2JvNjJibyQxMzliCjJvNjBiM28kMTkwYjJvJDE4OWJvYm8kMTkxYm8yJDIzM2JvJDIzM2IybyQyMzJib2JvNiQxNTVibzYxYm8kMTUzYm9ibwo2MmJvJDE1NGIybzYwYjNvMTliMm8kMTc1YjJvNjFibyQxNzRib2JvNTBib2JvNmJvYm8kMTc2Ym80OGJvM2JvNmIybyQKMjI1Ym8kMjI0Ym80Ym8kMjI1Ym8kMjE5YjJvNGJvM2JvJDIxOGJvYm82Ym9ibyQyMThibyQyMTdiMm8zJDE3MGJvJAoxNjhib2JvJDE2OWIybyQxNjBiMm8kMTU5Ym9ibyQxNjFibzEwJDEwNGIybzc5Ym84Ym8kMTA1Ym83N2JvYm82YjNvJAoxMDVib2JvMTBibzY1YjJvNWJvJDEwNmIybzliNG8yNGIybzQ0YjJvJDExNmIyb2JvYm8yMmJvYm8kMTE1YjNvYm8yYm8KMjNibyQxMTZiMm9ib2IybzY1YjNvJDExN2I0b2IzbzYzYjNvJDEwOWJvYm82Ym80Ym9ibzYxYm8zYm8kMTEwYjJvMTNibwo2MGJvNWJvJDExMGJvMTRiMm82MGJvM2JvJDE4OGIzbzUkMTc1Ym8kMTczYjJvJDEzMGIybzQyYjJvJDEyOWJvYm81NGIKMm8kOTNiM28zNWJvNTVibyQ5NWJvODhiM28kOTRibzg5Ym8kMTI0Ym9ibyQxMjViMm8kMTI1Ym8yJDE1NGJvJDE1NGIzbwokMTU3Ym8kMTU2YjJvMiQxNjNibyQxMTViMm80N2JvJDExNGJvYm80NWIzbyQ3OGIzbzM1Ym8kODBibyQ3OWJvJDEzOWJvCmJvMTZiM28kMTQwYjJvMTVibzNibyQxNDBibzE1Ym81Ym8kMTU2Ym81Ym8kMTU5Ym8kMTU3Ym8zYm8kMTU4Ym8kMTU5Ym8KMmJvJDE2MmJvJDE2MWJvMTZibyQxMDBiMm82MGIzbzE0Ym8kOTlib2JvNjJibzEyYjNvJDYzYjNvMzVibyQ2NWJvJDY0YgpvJDE1NGJvYm8kMTU1YjJvJDE1NWJvNSQzMGJvMTAzYjJvNDRibyQxMzRiM28kMzBibzg5Ym8xNWIyb2JvNDBibzEyYm8kCjg1YjJvMzFib2JvNGIzbzhibzJibzViMm8zNGJvMTJibyQ4NGJvYm8zMGJvYm8xNmIyb2JvNWIybzQ1YjNvJDQ4YjNvCjM1Ym8yNGIybzNibzJibzdibzJiMm8yYjNvJDUwYm82MGIybzRib2JvN2JvM2JvMmIybyQ0OWJvNjhib2JvNmJvMmJvJAoxMjBibzhiMm8zOGJvYm8kMzBibzJibzI2Ym8yYm84NmJvMmJvMTZiMm84Ym8yYm8yNmJvMmJvJDM0Ym8yOWJvNzFiNG8KMTRibzE1Ym8xM2JvMjlibyQzMGJvM2JvMjVibzNibzcwYm8zYm8xMGJvM2JvMjVibzNibzI1Ym8zYm8kMzFiNG8yNmI0bwo3NGJvMTFiNG8yNmI0bzI2YjRvJDkwYjJvNDNibzJibyQ5MGIybyQxMjViMm8kMTI2YjJvMTdiMm83YjJvJDEyNWJvMTliCm85Ym8zMGJvMjFibyQ3MGIybzRib2JvMTBiM281NGI5bzMxYjJvMjFibyQ2OWJvYm8xN2IzbzQ0YjJvNWIzbzJiNW8yYgozbzIzYjJvNGIybzE4YjNvJDMzYjNvMzVibzRiNW83Ym8zYm80MmIybzZibzJibzJiM28yYm8yYm8yM2IybzRiM28kMzViCm80MWIzbzdibzVibzEzYm85YjJvMThibzZiMm85YjJvMjRiMm80YjJvJDEzYjJvMTlibzQzYjJvOGJvM2JvMTNib2JvN2IKNG81OGIybzZiMm83YjJvMTViMm8kMTNiMm80MGJvYm8zMWIzbzdiMm80Ym9iMm81YjNvMmJvMmJvYm81MmJvYm82Ym84YgpvYm8xNGJvYm8kNTRibzJibzNiMm8zNmIybzNiMm9iMm85YjJvMmJvMmJvMjVibzI1Ym8xOWJvMTZibyQ1M2IybzViM29iCjJvMmIybzM1Ym9iMm82Ym85YjJvMTdiMm9ibzNiNG8yMWIybzE5YjJvMTViMm8kMTNiM28yOWIybzRiMm8zYm8zYm8zYm8KM2JvYm8xNWJvMTlib2JvNWJvOGJvM2IybzliMm8yYjJvYm9ibzRiNG81YjJvJDEzYjNvMjliMm82YjJvNWJvYm84Ym8KMTNiMm8yMGJvNmJvMTBiMm8xMGJvYm8yYjJvYm9iMm8zYm8yYm81YjJvJDQwYjJvMTJibzJibzJiMm82Ym8yYm83YjJvCjRib2JvMzRibzJibzEwYjNvOGIybzNiNG8kMjVibzE0YjJvMTNib2JvMTNibzdiMm80MWJvYm8xMGIzbzhiMm8zYjRvJAoyMmIybzQ0Ym9ibzY1YjNvMTJibyQxMWIybzNiMm83Ym80MmIybzY3Ym9ibyQxMmI1bzRibzRibzExMWIybyQxM2IzbzZiCm9iM28kMTRibzhiMm8yYm8xMmJvJDE4YjNvM2IzbzNibzlibzQ3Ym8kMjBibzRiMm8yYjJvOGJvYm80NWIzbyQxOWJvOWIKb2JvNmIyb2IybzQzYjVvJDM3Ym81Ym80MWJvYm9ib2JvJDQwYm80NGIybzNiMm8kMzdiMm8zYjJvMiQ4OGJvJDE1YjNvCjE4YjNvNDhib2JvJDM1YjJvYm80OGJvYm8kMTVib2JvMTdiMm81MWJvJDE0YjVvMTdiMm81MGIybyQxM2IybzNiMm8xN2IKb2JvNDhiMm8kMTNiMm8zYjJvMTdibzJiMm80NmIybyQyMDJiMm8kMjAxYm9ibyQxNmJvMTg0Ym8kMTdiMm8xODFiMm8yJAoxOWJvMTZiNW8kMzVib2Izb2JvJDE1Ym8yYm8xN2JvM2JvJDE1YjJvMjBiM28kMzhibzQkMzhiMm8kMzhiMm8hCg==',
  terminator: 'bzY4JDEyYjJvJDEyYm8kMTBib2JvJG8yYm82YjJvJDRibyRvM2JvJGI0byEK',
});

const CIRCUIT_DEFINITIONS = Object.freeze({
  and: {
    id: 'and',
    title: 'AND gate',
    description: 'An output packet arrives only when both finite input packet trains are present.',
    gateAsset: 'and',
    width: 800,
    height: 650,
    tileSize: 150,
    observeGeneration: 600,
    inputs: ['a', 'b'],
    outputs: [{ id: 'out', label: 'A AND B', x: 150, y: 75 }],
  },
  or: {
    id: 'or',
    title: 'OR gate',
    description: 'An output packet arrives when either finite input packet train is present.',
    gateAsset: 'or',
    width: 800,
    height: 650,
    tileSize: 150,
    observeGeneration: 600,
    inputs: ['a', 'b'],
    outputs: [{ id: 'out', label: 'A OR B', x: 150, y: 75 }],
  },
  not: {
    id: 'not',
    title: 'NOT gate',
    description: 'The built-in finite signal is suppressed when input A is present.',
    gateAsset: 'not',
    width: 800,
    height: 650,
    tileSize: 150,
    observeGeneration: 600,
    inputs: ['a'],
    outputs: [{ id: 'out', label: 'NOT A', x: 150, y: 75 }],
  },
  'half-adder': {
    id: 'half-adder',
    title: 'Binary half-adder',
    description: 'Two finite packet trains produce independently observed sum and carry packets.',
    gateAsset: 'halfAdder',
    width: 950,
    height: 340,
    tileSize: 300,
    observeGeneration: 1200,
    inputs: ['a', 'b'],
    outputs: [
      { id: 'sum', label: 'Sum', x: 300, y: 75 },
      { id: 'carry', label: 'Carry', x: 300, y: 225 },
    ],
  },
});

/**
 * Curated, real Conway circuit experiments. The gate geometry originates with
 * the CakeML Game of Life project (Magnus Myreen and Ramana Kumar's project,
 * based on work credited there to Nicolas Loizeau and Nicholas Carlini).
 * The project owner has authorized this use. See docs/circuit-research-handoff.md
 * for the source revision, hashes, probe recipe, and behavior verification.
 */
export const circuitExperiments = Object.freeze(Object.values(CIRCUIT_DEFINITIONS).map((definition) => ({
  id: definition.id,
  title: definition.title,
  description: definition.description,
  inputs: definition.inputs,
  outputs: definition.outputs,
  observeGeneration: definition.observeGeneration,
  finiteSignals: true,
  source: {
    name: 'CakeML Game of Life gate construction',
    url: 'https://github.com/CakeML/game-of-life',
    commit: 'c3439fc4c24948f93945c75c973e56ed4a001ad6',
    credits: 'CakeML project; repository credits Nicolas Loizeau and Nicholas Carlini.',
  },
})));

export function getCircuitExperiment(id) {
  const definition = CIRCUIT_DEFINITIONS[id];
  if (!definition) throw new Error(`Unknown circuit experiment: ${id}`);
  return circuitExperiments.find((experiment) => experiment.id === id);
}

export function buildCircuitExperiment(id, input = {}) {
  const definition = CIRCUIT_DEFINITIONS[id];
  if (!definition) throw new Error(`Unknown circuit experiment: ${id}`);
  const inputs = normalizeInputs(definition, input);
  const board = createBoard(definition.width, definition.height);
  const gate = decodeRawRle(RAW_RLE[definition.gateAsset]);
  const terminator = decodeRawRle(RAW_RLE.terminator);

  stampBounded(board, gate, GATE_ORIGIN.x, GATE_ORIGIN.y);
  stampBounded(board, terminator, GATE_ORIGIN.x + definition.tileSize, GATE_ORIGIN.y);
  if (definition.id === 'half-adder') {
    stampBounded(board, terminator, GATE_ORIGIN.x + definition.tileSize, GATE_ORIGIN.y + 150);
  }
  stampInputPackets(board, definition, inputs);

  const outputs = definition.outputs.map((port) => ({
    ...port,
    x: GATE_ORIGIN.x + port.x,
    y: GATE_ORIGIN.y + port.y,
    width: 12,
    height: 12,
  }));

  return {
    id: definition.id,
    title: definition.title,
    description: definition.description,
    inputs,
    outputs,
    observeGeneration: definition.observeGeneration,
    finiteSignals: true,
    wrapping: false,
    board,
    authoredBoard: cloneBoard(board),
  };
}

export function resetCircuitExperiment(experiment) {
  if (!experiment?.id) throw new Error('A circuit experiment is required.');
  if (experiment.spec) return buildCircuit({ ...experiment.spec, inputs: experiment.inputs });
  if (experiment.gates) return buildCircuitChain({ gates: experiment.gates, inputs: experiment.inputs });
  return buildCircuitExperiment(experiment.id, experiment.inputs);
}

export function createCircuitStepper(experiment) {
  if (!experiment?.board || experiment.wrapping !== false) {
    throw new Error('Circuit experiments require a bounded authored board.');
  }
  return createLifeStepper(experiment.board, { wrapping: false });
}

export function readCircuitOutputs(experiment, board = experiment?.board) {
  if (!experiment?.outputs || !board) throw new Error('A circuit experiment and board are required.');
  const settled = board.generation >= experiment.observeGeneration;
  return experiment.outputs.map((port) => {
    const population = countProbePopulation(board, port);
    return {
      id: port.id,
      label: port.label,
      population,
      settled,
      // A finite output packet is a nine-cell LWSS. Before the documented
      // observation generation, startup debris is intentionally not a value.
      high: settled ? population === 9 : null,
    };
  });
}

export function runCircuitToObservation(id, inputs) {
  const experiment = buildCircuitExperiment(id, inputs);
  const stepper = createCircuitStepper(experiment);
  let board = experiment.board;
  while (board.generation < experiment.observeGeneration) board = stepper.step();
  return { experiment, board, outputs: readCircuitOutputs(experiment, board) };
}

/**
 * Gate chaining. Gates sit side by side on the CakeML 150-cell tile grid with
 * no terminator between them, so each gate's eastbound output LWSS train is
 * the next gate's input A. Measured on this engine (see
 * docs/circuit-research-handoff.md and the chain findings): every gate emits
 * output packets in the same lane (tile rows 71-74), with the same 30-cell /
 * 60-generation spacing and the same phase as a source train entering the next
 * tile, so no wire or phase adjustment is needed. A gate's A-to-output latency
 * is 300 generations for AND (a transparent 150-cell wire) and 420 for OR and
 * NOT. Fresh northbound B trains for later gates are stamped further south by
 * half the accumulated upstream latency (LWSS moves at c/2), keeping the
 * designed A/B alignment, and the chain is observed at 600 plus the accumulated
 * latency of every gate but the last.
 */
const CHAIN_GATES = Object.freeze({
  and: { latency: 300, arity: 2 },
  or: { latency: 420, arity: 2 },
  not: { latency: 420, arity: 1 },
});
const CHAIN_TILE = 150;
// Chains up to this length use the original side-by-side layout below, byte for
// byte; longer chains are laid out by the branching engine further down.
const LEGACY_CHAIN_MAX_GATES = 3;
const CHAIN_PACKETS = 14;
const CHAIN_LANE = 70;
const PROBE_SIZE = 12;

export const circuitGateCatalog = Object.freeze([
  { id: 'and', title: 'AND gate', description: CIRCUIT_DEFINITIONS.and.description, inputs: ['a', 'b'], chainable: true, chainPosition: 'any' },
  { id: 'or', title: 'OR gate', description: CIRCUIT_DEFINITIONS.or.description, inputs: ['a', 'b'], chainable: true, chainPosition: 'any' },
  { id: 'not', title: 'NOT gate', description: CIRCUIT_DEFINITIONS.not.description, inputs: ['a'], chainable: true, chainPosition: 'any' },
  { id: 'half-adder', title: 'Binary half-adder', description: CIRCUIT_DEFINITIONS['half-adder'].description, inputs: ['a', 'b'], chainable: false, chainPosition: 'standalone' },
].map((entry) => Object.freeze(entry)));

export function validateCircuitChain(gates) {
  if (!Array.isArray(gates) || gates.length === 0) return { ok: false, reason: 'A chain needs at least one gate.' };
  for (const id of gates) {
    if (id === 'half-adder') return { ok: false, reason: 'The half-adder is standalone: it has two outputs on two lanes and cannot join a chain.' };
    if (!CHAIN_GATES[id]) return { ok: false, reason: `Unknown gate "${id}".` };
  }
  if (gates.length > CIRCUIT_MAX_CHAIN_GATES) return { ok: false, reason: `Up to ${CIRCUIT_MAX_CHAIN_GATES} gates in one chain.` };
  return { ok: true, reason: null };
}

export function getCircuitChainInputs(gates) {
  if (!Array.isArray(gates)) throw new Error('A chain is an array of gate ids.');
  const names = ['a'];
  for (const id of gates) {
    const gate = CHAIN_GATES[id];
    if (!gate) throw new Error(`Unknown gate "${id}".`);
    if (gate.arity === 2) names.push(String.fromCharCode(97 + names.length));
  }
  return names;
}

export function buildCircuitChain({ gates, inputs = {} } = {}) {
  const validation = validateCircuitChain(gates);
  if (!validation.ok) throw new Error(validation.reason);
  const names = getCircuitChainInputs(gates);
  const values = {};
  for (const name of names) values[name] = Boolean(inputs[name]);
  if (gates.length > LEGACY_CHAIN_MAX_GATES) return buildTreeCircuit(normalizeCircuitSpec({ gates, inputs: values }), { gates });
  const layout = layoutChain(gates);

  const board = createBoard(layout.width, layout.height);
  const eastbound = decodePlainRawRle(INPUT_PACKET_EAST);
  const northbound = decodePlainRawRle(INPUT_PACKET_NORTH);
  for (const tile of layout.tiles) {
    stampBounded(board, decodeRawRle(RAW_RLE[tile.gateId]), tile.x, tile.y);
    for (const input of tile.inputs) {
      if (!values[input.name]) continue;
      for (let packet = 1; packet <= CHAIN_PACKETS; packet += 1) {
        if (input.side === 'west') stampBounded(board, eastbound, tile.x - 5 - 30 * packet, tile.y + CHAIN_LANE);
        else stampBounded(board, northbound, tile.x + CHAIN_LANE, tile.y + CHAIN_TILE + 10 + input.delay + 30 * (packet - 1));
      }
    }
  }
  stampBounded(board, decodeRawRle(RAW_RLE.terminator), layout.terminator.x, layout.terminator.y);

  const output = { id: 'out', label: describeChainExpression(gates, names), ...layout.output, width: PROBE_SIZE, height: PROBE_SIZE };
  const tiles = layout.tiles.map((tile) => ({
    gateId: tile.gateId,
    index: tile.index,
    x: tile.x,
    y: tile.y,
    width: CHAIN_TILE,
    height: CHAIN_TILE,
    inputs: tile.inputs.map(({ name, side, x, y }) => ({ name, side, x, y })),
  }));
  const ports = [
    ...tiles.flatMap((tile) => tile.inputs.map((input) => ({ type: 'input', tileIndex: tile.index, ...input }))),
    { type: 'output', tileIndex: tiles.length - 1, ...output },
  ];

  return {
    id: `chain:${gates.join('>')}`,
    title: `${describeChain(gates)} chain`,
    description: 'Gates tiled on the 150-cell grid; each output LWSS train feeds the next gate, later inputs arrive from the south with matched delays.',
    gates: [...gates],
    inputs: values,
    outputs: [output],
    observeGeneration: layout.observeGeneration,
    finiteSignals: true,
    wrapping: false,
    board,
    authoredBoard: cloneBoard(board),
    tiles,
    ports,
  };
}

export function runCircuitChainToObservation(gates, inputs) {
  const experiment = buildCircuitChain({ gates, inputs });
  const stepper = createCircuitStepper(experiment);
  let board = experiment.board;
  while (board.generation < experiment.observeGeneration) board = stepper.step();
  return { experiment, board, outputs: readCircuitOutputs(experiment, board) };
}

export function getCircuitChainTruthTable(gates) {
  const validation = validateCircuitChain(gates);
  if (!validation.ok) throw new Error(validation.reason);
  const names = getCircuitChainInputs(gates);
  const rows = [];
  for (let mask = 0; mask < 1 << names.length; mask += 1) {
    const inputs = {};
    names.forEach((name, index) => { inputs[name] = Boolean(mask & (1 << index)); });
    const { outputs } = runCircuitChainToObservation(gates, inputs);
    rows.push({ inputs, outputs: { out: outputs[0].high === true } });
  }
  return rows;
}

function layoutChain(gates) {
  const names = getCircuitChainInputs(gates);
  const tiles = [];
  let nextName = 1;
  let upstreamLatency = 0;
  let maxDelay = 0;
  gates.forEach((gateId, index) => {
    const x = GATE_ORIGIN.x + CHAIN_TILE * index;
    const y = GATE_ORIGIN.y;
    const inputs = [];
    if (index === 0) inputs.push({ name: names[0], side: 'west', x, y: y + CHAIN_LANE + 2, delay: 0 });
    if (CHAIN_GATES[gateId].arity === 2) {
      const delay = chainSouthDelayCells(gateId, upstreamLatency / 2);
      maxDelay = Math.max(maxDelay, delay);
      inputs.push({ name: names[nextName], side: 'south', x: x + CHAIN_LANE + 2, y: y + CHAIN_TILE, delay });
      nextName += 1;
    }
    tiles.push({ gateId, index, x, y, inputs });
    upstreamLatency += CHAIN_GATES[gateId].latency;
  });
  const last = tiles[tiles.length - 1];
  return {
    tiles,
    width: GATE_ORIGIN.x + CHAIN_TILE * (gates.length + 1) + 20,
    height: 650 + maxDelay,
    terminator: { x: last.x + CHAIN_TILE, y: GATE_ORIGIN.y },
    output: { x: last.x + CHAIN_TILE, y: GATE_ORIGIN.y + 75 },
    observeGeneration: 600 + upstreamLatency - CHAIN_GATES[last.gateId].latency,
  };
}

// Southbound stamping offset in cells for a gate's fresh B train: half the
// accumulated upstream latency keeps the designed A/B alignment. The OR's B
// reaction drops still-life ash into its own B column south of the tile, which
// destroys a train still travelling there; a lone-OR delay sweep against every
// upstream train shape found these lattice offsets keep all 14 packets intact,
// so an OR's train snaps down to the nearest one. Its output is widened to
// three packets per B packet, so arriving early does not change the result.
const OR_SOUTH_DELAYS = [0, 30, 90, 180, 270, 300, 390];
function chainSouthDelayCells(gateId, nominal) {
  if (gateId !== 'or') return nominal;
  return OR_SOUTH_DELAYS.filter((delay) => delay <= nominal).pop();
}

function describeChain(gates) {
  return gates.map((id) => id.toUpperCase()).join(' → ');
}

function describeChainExpression(gates, names) {
  let expression = names[0].toUpperCase();
  let nextName = 1;
  for (const id of gates) {
    if (id === 'not') expression = /^[A-Z]$/.test(expression) ? `NOT ${expression}` : `NOT (${expression})`;
    else {
      const operand = names[nextName].toUpperCase();
      nextName += 1;
      expression = /^[A-Z]$/.test(expression) ? `${expression} ${id.toUpperCase()} ${operand}` : `(${expression}) ${id.toUpperCase()} ${operand}`;
    }
  }
  return expression;
}

function normalizeInputs(definition, input) {
  const values = {};
  for (const name of definition.inputs) values[name] = Boolean(input[name]);
  return values;
}

function stampInputPackets(board, definition, inputs) {
  const eastbound = decodePlainRawRle(INPUT_PACKET_EAST);
  const northbound = decodePlainRawRle(INPUT_PACKET_NORTH);
  for (let packet = 1; packet <= 14; packet += 1) {
    if (inputs.a) {
      stampBounded(board, eastbound, GATE_ORIGIN.x - 5 - 30 * packet, GATE_ORIGIN.y + 70);
    }
    if (!inputs.b) continue;
    if (definition.id === 'half-adder') {
      stampBounded(board, eastbound, GATE_ORIGIN.x - 5 - 30 * packet, GATE_ORIGIN.y + 220);
    } else if (definition.inputs.includes('b')) {
      stampBounded(board, northbound, GATE_ORIGIN.x + 70, GATE_ORIGIN.y + 160 + 30 * (packet - 1));
    }
  }
}

function stampBounded(board, coordinates, originX, originY) {
  for (const [x, y] of coordinates) {
    const targetX = originX + x;
    const targetY = originY + y;
    if (targetX >= 0 && targetY >= 0 && targetX < board.width && targetY < board.height) {
      board.cells[targetY * board.width + targetX] = 1;
    }
  }
}

function countProbePopulation(board, probe) {
  let population = 0;
  const startX = probe.x - Math.floor(probe.width / 2);
  const startY = probe.y - Math.floor(probe.height / 2);
  for (let y = startY; y < startY + probe.height; y += 1) {
    for (let x = startX; x < startX + probe.width; x += 1) {
      if (x >= 0 && y >= 0 && x < board.width && y < board.height) population += board.cells[y * board.width + x];
    }
  }
  return population;
}

function decodeRawRle(encoded) {
  return decodePlainRawRle(decodeBase64(encoded));
}

function decodePlainRawRle(text) {
  const coordinates = [];
  let x = 0;
  let y = 0;
  let digits = '';

  for (const token of text.replace(/\s/g, '')) {
    if (/\d/.test(token)) {
      digits += token;
      continue;
    }
    const count = digits ? Number(digits) : 1;
    digits = '';
    if (!Number.isSafeInteger(count) || count < 1) throw new Error('Invalid raw circuit RLE.');
    if (token === 'b') x += count;
    else if (token === 'o') {
      for (let index = 0; index < count; index += 1) coordinates.push([x + index, y]);
      x += count;
    } else if (token === '$') {
      y += count;
      x = 0;
    } else if (token === '!') return coordinates;
    else throw new Error(`Unsupported raw circuit RLE token: ${token}`);
  }
  throw new Error('Raw circuit RLE is missing its terminator.');
}

function decodeBase64(value) {
  if (typeof atob === 'function') return atob(value);
  return Buffer.from(value, 'base64').toString('utf8');
}

/**
 * Branching circuits.
 *
 * Any spec that circuit-spec.js accepts (legacy chain, half-adder, preset, or
 * an AND/OR/NOT expression tree with reusable inputs) is turned into one bounded
 * board. Trees are laid out recursively from the verified CakeML tiles:
 *
 * - A gate's first operand ("A") arrives from the west as an eastbound LWSS
 *   train, so an A sub-circuit sits to the west, output lane to input lane,
 *   exactly like the chain. A gap between the tiles is free wire.
 * - A gate's second operand ("B") arrives from the south. A B sub-circuit is
 *   the same layout reflected across the anti-diagonal (Life is reflection
 *   invariant): its output then travels north into the parent's B column, its
 *   own A chain grows further south and its own B inputs come from the west,
 *   so every construction only grows west and south of the root.
 * - Every gate's clock is 60 generations (one packet slot = 30 cells of LWSS
 *   travel), so every input delay is a multiple of 60 and every gap a multiple
 *   of 30 cells. Measured latencies: AND 300 (a transparent wire), OR 420 and
 *   NOT 420 (the NOT is a p60 gun whose stream the A train suppresses).
 * - Leaf B trains: AND wants the standard position (+30k); the OR wants +3 for
 *   a clean phase and +60 more because its B path is two slots faster than its
 *   A path, i.e. +63. A reflected sub-circuit under an AND is placed with its
 *   tile at x-4 and y + (tA - childDelay)/2 + 134, measured slot-exactly with
 *   20-packet trains (see docs/circuit-research-handoff.md).
 *
 * Verified restrictions (validateCircuit explains them in plain English): an
 * OR takes at most one gate operand (it goes on the A side; its B must be a
 * switch), an AND takes at most one never-ending operand (a NOT-driven signal;
 * it goes on the A side), and the whole board stays within 3000 cells.
 */
export const CIRCUIT_MAX_CHAIN_GATES = 6;
export const CIRCUIT_MAX_GATES = 10;
const BOARD_LIMIT = 3000;
const SLOT_CELLS = 30;
const LEAF_B_OFFSET = Object.freeze({ and: 0, or: 63 });
const CHILD_B_OFFSET = 134;
const CHILD_B_X = -4;
const TREE_PACKETS = 14;
const TERMINATOR_WIDTH = 14;

function xorTree(x, y) {
  return gateNode('and', gateNode('not', gateNode('and', x, y)), gateNode('or', x, y));
}
const a = () => inputNode('a');
const b = () => inputNode('b');
const c = () => inputNode('c');

export const circuitPresets = Object.freeze([
  {
    id: 'xor',
    name: 'XOR',
    title: 'XOR',
    description: 'Lights when exactly one of A and B is on: an OR gate and an AND gate feeding a NOT, combined by a final AND.',
    spec: { outputs: [{ id: 'out', label: 'A XOR B', tree: xorTree(a(), b()) }], inputs: { a: false, b: false } },
  },
  {
    id: 'full-adder',
    name: 'Full adder',
    title: 'Full adder',
    description: 'Adds three bits A, B and C: Sum lights for an odd count of ones and Carry when at least two are on.',
    spec: {
      outputs: [
        { id: 'sum', label: 'Sum', tree: xorTree(xorTree(a(), b()), c()) },
        { id: 'carry', label: 'Carry', tree: gateNode('and', gateNode('or', a(), b()), gateNode('or', gateNode('and', a(), b()), c())) },
      ],
      inputs: { a: false, b: false, c: false },
    },
  },
].map((preset) => Object.freeze(preset)));

function getPreset(id) {
  return circuitPresets.find((preset) => preset.id === id) ?? null;
}

// Expands presets so every spec becomes 'half-adder' or 'tree'.
function resolveSpec(spec) {
  const normalized = normalizeCircuitSpec(spec);
  if (normalized.kind !== 'preset') return normalized;
  const preset = getPreset(normalized.id);
  if (!preset) throw new Error(`Unknown circuit preset "${normalized.id}".`);
  const expanded = normalizeCircuitSpec({ ...preset.spec, inputs: { ...preset.spec.inputs, ...normalized.inputs } });
  return { ...expanded, preset: preset.id };
}

export function validateCircuit(spec) {
  const shape = validateCircuitSpecShape(spec);
  if (!shape.ok) return shape;
  let normalized;
  try {
    normalized = resolveSpec(spec);
  } catch (error) {
    return { ok: false, reason: error.message };
  }
  if (normalized.kind === 'half-adder') return { ok: true, reason: null };
  if (normalized.outputs.length > MAX_OUTPUTS) return { ok: false, reason: `${MAX_OUTPUTS === 2 ? 'Two' : MAX_OUTPUTS} outputs at most.` };
  const chain = normalized.outputs.length === 1 ? treeToChain(normalized.outputs[0].tree) : null;
  if (chain) return validateCircuitChain(chain);
  const total = normalized.outputs.reduce((sum, output) => sum + countGates(output.tree), 0);
  if (total > CIRCUIT_MAX_GATES) return { ok: false, reason: `Circuits here can use up to ${CIRCUIT_MAX_GATES} gates.` };
  for (const output of normalized.outputs) {
    const problem = findUnsupportedNode(output.tree);
    if (problem) return { ok: false, reason: problem };
  }
  try {
    planCircuit(normalized);
  } catch (error) {
    return { ok: false, reason: error.message };
  }
  return { ok: true, reason: null };
}

export function buildCircuit(spec) {
  const validation = validateCircuit(spec);
  if (!validation.ok) throw new Error(validation.reason);
  const normalized = resolveSpec(spec);
  if (normalized.kind === 'half-adder') {
    return { ...buildCircuitExperiment('half-adder', normalized.inputs), spec: { gates: ['half-adder'], inputs: normalized.inputs } };
  }
  const chain = normalized.outputs.length === 1 ? treeToChain(normalized.outputs[0].tree) : null;
  if (chain && chain.length <= LEGACY_CHAIN_MAX_GATES) {
    return { ...buildCircuitChain({ gates: chain, inputs: normalized.inputs }), spec: { gates: chain, inputs: normalized.inputs } };
  }
  return buildTreeCircuit(normalized, { gates: chain ?? undefined });
}

// The expected boolean table, in the same row order as getCircuitChainTruthTable.
export function getCircuitTruthTable(spec) {
  const normalized = resolveSpec(spec);
  const names = normalized.kind === 'half-adder' ? ['a', 'b'] : Object.keys(normalized.inputs);
  const rows = [];
  for (let mask = 0; mask < 1 << names.length; mask += 1) {
    const inputs = {};
    names.forEach((name, index) => { inputs[name] = Boolean(mask & (1 << index)); });
    const outputs = {};
    if (normalized.kind === 'half-adder') {
      outputs.sum = inputs.a !== inputs.b;
      outputs.carry = inputs.a && inputs.b;
    } else {
      for (const output of normalized.outputs) outputs[output.id] = evaluateTree(output.tree, inputs);
    }
    rows.push({ inputs, outputs });
  }
  return rows;
}

export function evaluateTree(node, inputs) {
  if (isInputNode(node)) return Boolean(inputs[node.input]);
  if (node.gate === 'not') return !evaluateTree(node.a, inputs);
  const first = evaluateTree(node.a, inputs);
  const second = evaluateTree(node.b, inputs);
  return node.gate === 'and' ? first && second : first || second;
}

function countGates(node) {
  if (!isGateNode(node)) return 0;
  return 1 + countGates(node.a) + (GATE_ARITY[node.gate] === 2 ? countGates(node.b) : 0);
}

// A signal "ends" when its train is finite. NOT gates emit a never-ending
// stream (their gun keeps firing outside the input window); an AND with one
// finite operand cuts it back down, an OR keeps it going.
function signalEnds(node) {
  if (isInputNode(node)) return true;
  if (node.gate === 'not') return false;
  if (node.gate === 'and') return signalEnds(node.a) || signalEnds(node.b);
  return signalEnds(node.a) && signalEnds(node.b);
}

function findUnsupportedNode(node) {
  if (!isGateNode(node)) return null;
  if (node.gate === 'or' && isGateNode(node.a) && isGateNode(node.b)) {
    return 'An OR gate can take only one other gate as an input here; its other input must be a switch.';
  }
  if (node.gate === 'and' && !signalEnds(node.a) && !signalEnds(node.b)) {
    return 'An AND gate can take at most one input that runs through a NOT gate.';
  }
  const first = findUnsupportedNode(node.a);
  if (first) return first;
  return GATE_ARITY[node.gate] === 2 ? findUnsupportedNode(node.b) : null;
}

// Operand order the layout can build: a gate operand of an OR goes on the A
// side, and a never-ending operand of an AND goes on the A side.
function orderOperands(node) {
  if (node.gate === 'not') return [node.a, undefined];
  let first = node.a;
  let second = node.b;
  if (node.gate === 'or' && isGateNode(second) && isInputNode(first)) [first, second] = [second, first];
  if (node.gate === 'and' && isGateNode(second) && !signalEnds(second) && signalEnds(first)) [first, second] = [second, first];
  return [first, second];
}

// Anti-diagonal reflection of a child frame whose tile sits at (hx, hy).
function reflectPoint(hx, hy, [x, y]) {
  return [hx + 149 - y, hy + 149 - x];
}
const REFLECTED_SIDE = Object.freeze({ west: 'south', south: 'west', east: 'north', north: 'east' });

/**
 * Lays out one expression tree in its root's frame (root tile at 0,0). Returns
 * cells, obstacle rects, tile/port metadata and the output delay in generations.
 * `base` is an extra delay given to every switch train (used to synchronise the
 * two outputs of a two-output circuit).
 */
function layoutTree(node, base, values) {
  if (isInputNode(node)) throw new Error('A circuit needs at least one gate.');
  const [first, second] = orderOperands(node);
  const aLayout = isGateNode(first) ? layoutTree(first, base, values) : null;
  const bLayout = second !== undefined && isGateNode(second) ? layoutTree(second, base, values) : null;
  const chosen = layoutGate(node.gate, first, aLayout, second, bLayout, base, values);
  // An AND with two gate operands can hang either one; keep the more compact result.
  if (node.gate === 'and' && aLayout && bLayout && signalEnds(first)) {
    const swapped = layoutGate(node.gate, second, bLayout, first, aLayout, base, values);
    if (footprint(swapped) < footprint(chosen)) return swapped;
  }
  return chosen;
}

function footprint(layout) {
  let minX = 0; let maxY = CHAIN_TILE;
  for (const [x0, , , y1] of layout.rects) { minX = Math.min(minX, x0); maxY = Math.max(maxY, y1); }
  return Math.max(-minX, maxY) * 4 + (-minX + maxY);
}

function layoutGate(gate, first, aChild, second, bChild, base, values) {
  const latency = CHAIN_GATES[gate].latency;

  // A-side delay (generations); gaps are multiples of one slot.
  let gap = 0;
  let tA = aChild ? aChild.delay : base;
  if (bChild) {
    if (gate !== 'and') throw new Error('An OR gate can take only one other gate as an input here; its other input must be a switch.');
    // One slot of extra A delay keeps the reflected child's tile clear of this tile.
    const earliest = bChild.delay + 60;
    if (tA < earliest) {
      if (aChild) gap = (earliest - aChild.delay) / 2;
      tA = earliest;
    }
  }
  const place = (extra) => {
    const aShift = aChild ? -CHAIN_TILE - gap - extra : 0;
    const aDelay = tA + 2 * extra;
    const hy = bChild ? (aDelay - bChild.delay) / 2 + CHILD_B_OFFSET : 0;
    return { aShift, aDelay, hy };
  };
  let extra = 0;
  let placement = place(0);
  if (aChild && bChild) {
    const aRects = () => aChild.rects.map(([x0, y0, x1, y1]) => [x0 + placement.aShift, y0, x1 + placement.aShift, y1]);
    const bRects = () => bChild.rects.map((rect) => reflectRect(CHILD_B_X, placement.hy, rect));
    while (rectsOverlap(aRects(), bRects())) {
      extra += SLOT_CELLS;
      if (extra > BOARD_LIMIT) throw new Error('These gates cannot be arranged on the board.');
      placement = place(extra);
    }
  }
  const { aShift, aDelay, hy } = placement;

  const cells = decodeRawRle(RAW_RLE[gate]).map(([x, y]) => [x, y]);
  const rects = [[-3, -3, CHAIN_TILE + 3, CHAIN_TILE + 3]];
  const tile = { gateId: gate, x: 0, y: 0, mirrored: false, inputs: [], output: { side: 'east', x: CHAIN_TILE, y: 75 } };
  const tiles = [tile];
  const ports = [];

  // A operand.
  if (aChild) {
    for (const cell of aChild.cells) cells.push([cell[0] + aShift, cell[1]]);
    for (const rect of aChild.rects) rects.push([rect[0] + aShift, rect[1], rect[2] + aShift, rect[3]]);
    if (aShift + CHAIN_TILE < 0) rects.push([aShift + CHAIN_TILE, 68, 0, 77]);
    for (const child of aChild.tiles) tiles.push({ ...child, x: child.x + aShift, inputs: child.inputs.map((input) => ({ ...input, x: input.x + aShift })), output: { ...child.output, x: child.output.x + aShift } });
    for (const port of aChild.ports) ports.push({ ...port, x: port.x + aShift, tileIndex: port.tileIndex + 1 });
  } else {
    const name = first.input;
    const west = aDelay / 2;
    if (values[name]) for (let k = 0; k < TREE_PACKETS; k += 1) for (const [x, y] of decodePlainRawRle(INPUT_PACKET_EAST)) cells.push([-35 - west - 30 * k + x, 70 + y]);
    rects.push([-35 - west - 30 * (TREE_PACKETS - 1) - 3, 68, 0, 77]);
    tile.inputs.push({ name, side: 'west', x: 0, y: 72 });
  }

  // B operand.
  if (second !== undefined) {
    if (bChild) {
      for (const cell of bChild.cells) cells.push(reflectPoint(CHILD_B_X, hy, cell));
      for (const rect of bChild.rects) rects.push(reflectRect(CHILD_B_X, hy, rect));
      rects.push([68, CHAIN_TILE, 77, hy]);
      const offset = tiles.length;
      for (const child of bChild.tiles) {
        const [x1, y1] = reflectPoint(CHILD_B_X, hy, [child.x, child.y]);
        const [x2, y2] = reflectPoint(CHILD_B_X, hy, [child.x + CHAIN_TILE - 1, child.y + CHAIN_TILE - 1]);
        const [ox, oy] = reflectPoint(CHILD_B_X, hy, [child.output.x, child.output.y]);
        tiles.push({
          ...child,
          x: Math.min(x1, x2),
          y: Math.min(y1, y2),
          mirrored: !child.mirrored,
          inputs: child.inputs.map((input) => { const [x, y] = reflectPoint(CHILD_B_X, hy, [input.x, input.y]); return { ...input, side: REFLECTED_SIDE[input.side], x, y }; }),
          output: { side: REFLECTED_SIDE[child.output.side], x: ox, y: oy },
        });
      }
      for (const port of bChild.ports) {
        const [x, y] = reflectPoint(CHILD_B_X, hy, [port.x, port.y]);
        ports.push({ ...port, side: REFLECTED_SIDE[port.side], x, y, tileIndex: port.tileIndex + offset });
      }
    } else {
      const name = second.input;
      const dy = aDelay / 2 + LEAF_B_OFFSET[gate];
      if (values[name]) for (let k = 0; k < TREE_PACKETS; k += 1) for (const [x, y] of decodePlainRawRle(INPUT_PACKET_NORTH)) cells.push([70 + x, 160 + dy + 30 * k + y]);
      rects.push([68, CHAIN_TILE, 77, 160 + dy + 30 * (TREE_PACKETS - 1) + 7]);
      tile.inputs.push({ name, side: 'south', x: 72, y: CHAIN_TILE });
    }
  }
  for (const input of tile.inputs) ports.push({ type: 'input', tileIndex: 0, ...input });

  return { cells, rects, tiles, ports, delay: aDelay + latency };
}

function reflectRect(hx, hy, [x0, y0, x1, y1]) {
  const [ax, ay] = reflectPoint(hx, hy, [x0, y0]);
  const [bx, by] = reflectPoint(hx, hy, [x1, y1]);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

function rectsOverlap(first, second) {
  for (const [ax0, ay0, ax1, ay1] of first) {
    for (const [bx0, by0, bx1, by1] of second) {
      if (ax0 <= bx1 && bx0 <= ax1 && ay0 <= by1 && by0 <= ay1) return true;
    }
  }
  return false;
}

// Lays out every output and places them on one board, stacked top to bottom.
// Outputs share one observation generation: a faster output's terminator and
// probe sit further east, so its train spends the difference as free wire.
// Throws with a user-facing reason when the board would be too large.
function planCircuit(normalized) {
  const values = normalized.inputs;
  const layouts = normalized.outputs.map((output) => layoutTree(output.tree, 0, values));
  const rootDelays = layouts.map((layout, index) => layout.delay - CHAIN_GATES[normalized.outputs[index].tree.gate].latency);
  const target = Math.max(...rootDelays);
  const probeOffsets = rootDelays.map((delay) => (target - delay) / 2);
  const extents = layouts.map((layout) => {
    let minX = 0; let maxY = CHAIN_TILE;
    for (const [x0, y0, x1, y1] of layout.rects) { minX = Math.min(minX, x0); maxY = Math.max(maxY, y1); }
    for (const [x, y] of layout.cells) { minX = Math.min(minX, x); maxY = Math.max(maxY, y); }
    let minTileX = 0;
    for (const tile of layout.tiles) minTileX = Math.min(minTileX, tile.x);
    return { minX, maxY, minTileX };
  });
  const rootX = Math.max(...extents.map((extent) => Math.max(GATE_ORIGIN.x - extent.minTileX, 10 - extent.minX)));
  const rootYs = [];
  let nextY = GATE_ORIGIN.y;
  extents.forEach((extent) => {
    rootYs.push(nextY);
    nextY += extent.maxY + 40;
  });
  const width = rootX + CHAIN_TILE + Math.max(...probeOffsets) + TERMINATOR_WIDTH + 20;
  const height = nextY;
  if (width > BOARD_LIMIT || height > BOARD_LIMIT) throw new Error('This circuit is too large for the board.');
  return { layouts, rootX, rootYs, probeOffsets, width, height, observeGeneration: 600 + target };
}

function buildTreeCircuit(normalized, { gates } = {}) {
  const plan = planCircuit(normalized);
  const board = createBoard(plan.width, plan.height);
  const terminator = decodeRawRle(RAW_RLE.terminator);
  const tiles = [];
  const ports = [];
  const outputs = [];
  normalized.outputs.forEach((output, index) => {
    const layout = plan.layouts[index];
    const ox = plan.rootX;
    const oy = plan.rootYs[index];
    const probeX = ox + CHAIN_TILE + plan.probeOffsets[index];
    stampBounded(board, layout.cells, ox, oy);
    stampBounded(board, terminator, probeX, oy);
    const offset = tiles.length;
    for (const tile of layout.tiles) {
      tiles.push({
        gateId: tile.gateId,
        index: tiles.length,
        outputId: output.id,
        x: tile.x + ox,
        y: tile.y + oy,
        width: CHAIN_TILE,
        height: CHAIN_TILE,
        rotation: tile.mirrored ? 90 : 0,
        mirrored: tile.mirrored,
        inputs: tile.inputs.map((input) => ({ name: input.name, side: input.side, x: input.x + ox, y: input.y + oy })),
        output: { side: tile.output.side, x: tile.output.x + ox, y: tile.output.y + oy },
      });
    }
    for (const port of layout.ports) ports.push({ ...port, x: port.x + ox, y: port.y + oy, tileIndex: port.tileIndex + offset });
    const probe = { id: output.id, label: output.label, x: probeX, y: oy + 75, width: PROBE_SIZE, height: PROBE_SIZE };
    outputs.push(probe);
    ports.push({ type: 'output', tileIndex: offset, ...probe });
  });
  const spec = gates
    ? { gates: [...gates], inputs: { ...normalized.inputs } }
    : normalized.preset
      ? { preset: normalized.preset, inputs: { ...normalized.inputs } }
      : { outputs: normalized.outputs.map((output) => ({ id: output.id, label: output.label, tree: output.tree })), inputs: { ...normalized.inputs } };
  const preset = normalized.preset ? getPreset(normalized.preset) : null;
  const expressions = normalized.outputs.map((output) => `${output.label} = ${describeTree(output.tree)}`);
  return {
    id: gates ? `chain:${gates.join('>')}` : preset ? `preset:${preset.id}` : `tree:${normalized.outputs.map((output) => serializeTree(output.tree)).join('|')}`,
    title: gates ? `${describeChain(gates)} chain` : preset ? preset.title : 'Custom circuit',
    description: gates
      ? 'Gates tiled on the 150-cell grid; each output train feeds the next gate, later inputs arrive from the south with matched delays.'
      : preset?.description ?? expressions.join('; '),
    ...(gates ? { gates: [...gates] } : {}),
    spec,
    inputs: { ...normalized.inputs },
    outputs: gates ? [{ ...outputs[0], label: describeChainExpression(gates, getCircuitChainInputs(gates)) }] : outputs,
    observeGeneration: plan.observeGeneration,
    finiteSignals: true,
    wrapping: false,
    board,
    authoredBoard: cloneBoard(board),
    tiles,
    ports: gates ? ports.map((port) => (port.type === 'output' ? { ...port, label: describeChainExpression(gates, getCircuitChainInputs(gates)) } : port)) : ports,
  };
}

function serializeTree(node) {
  if (isInputNode(node)) return node.input;
  if (node.gate === 'not') return `not(${serializeTree(node.a)})`;
  return `${node.gate}(${serializeTree(node.a)},${serializeTree(node.b)})`;
}

export function runCircuitSpecToObservation(spec) {
  const experiment = buildCircuit(spec);
  const stepper = createCircuitStepper(experiment);
  let board = experiment.board;
  while (board.generation < experiment.observeGeneration) board = stepper.step();
  return { experiment, board, outputs: readCircuitOutputs(experiment, board) };
}
