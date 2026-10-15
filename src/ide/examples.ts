import type { World } from '../lang/robot';

export const WORLDS: Record<string, World> = {
  'Open field 5×5': { width: 5, height: 5, walls: [], start: { x: 0, y: 4, dir: 0 }, goal: { x: 4, y: 0 } },
  'Corridor': {
    width: 6, height: 4,
    walls: ['1,0', '1,1', '1,2', '3,1', '3,2', '3,3', '5,0', '5,1', '5,2'],
    start: { x: 0, y: 0, dir: 2 }, goal: { x: 4, y: 0 },
  },
  'Maze 7×7': {
    width: 7, height: 7,
    walls: [
      '1,0', '1,1', '1,2', '1,3', '1,5', '1,6',
      '3,1', '3,2', '3,3', '3,4', '3,5',
      '2,5', '5,0', '5,1', '5,3', '5,4', '5,5', '5,6', '4,3',
    ],
    start: { x: 0, y: 0, dir: 2 }, goal: { x: 6, y: 6 },
  },
  'Exam-style 5×5': {
    width: 5, height: 5,
    walls: ['0,0', '1,0', '3,0', '4,0', '0,1', '4,1', '0,2', '2,2', '4,2', '0,3', '4,3'],
    start: { x: 1, y: 4, dir: 0 }, goal: { x: 2, y: 0 },
  },
};

export interface Example {
  name: string;
  code: string;
  world?: string;
}

export const EXAMPLES: Example[] = [
  {
    name: 'Hello, variables',
    code: `// Variables, arithmetic and DISPLAY
name ← "Ada"
age ← 16
DISPLAY("Hi")
DISPLAY(name)
DISPLAY(age + 1)
DISPLAY(17 MOD 5)
DISPLAY(7 / 2)
`,
  },
  {
    name: 'Average of a list',
    code: `scores ← [88, 92, 79, 95, 100]
total ← 0
FOR EACH score IN scores
{
    total ← total + score
}
average ← total / LENGTH(scores)
DISPLAY(average)
`,
  },
  {
    name: 'Find the maximum',
    code: `PROCEDURE findMax(numbers)
{
    max ← numbers[1]
    FOR EACH num IN numbers
    {
        IF (num > max)
        {
            max ← num
        }
    }
    RETURN(max)
}

DISPLAY(findMax([4, 17, 9, 22, 3]))
`,
  },
  {
    name: 'Linear search',
    code: `PROCEDURE search(list, target)
{
    index ← 1
    REPEAT UNTIL (index > LENGTH(list))
    {
        IF (list[index] = target)
        {
            RETURN(index)
        }
        index ← index + 1
    }
    RETURN(-1)
}

fruits ← ["apple", "kiwi", "mango", "pear"]
DISPLAY(search(fruits, "mango"))
DISPLAY(search(fruits, "plum"))
`,
  },
  {
    name: 'List procedures',
    code: `colors ← ["red", "green"]
APPEND(colors, "blue")
INSERT(colors, 2, "yellow")
DISPLAY(colors)
REMOVE(colors, 1)
DISPLAY(colors)
DISPLAY(LENGTH(colors))
copy ← colors
APPEND(copy, "pink")
DISPLAY(colors)
`,
  },
  {
    name: 'Bubble sort',
    code: `PROCEDURE swap(list, i, j)
{
    temp ← list[i]
    list[i] ← list[j]
    list[j] ← temp
}

nums ← [5, 2, 9, 1, 7]
n ← LENGTH(nums)
REPEAT n - 1 TIMES
{
    i ← 1
    REPEAT n - 1 TIMES
    {
        IF (nums[i] > nums[i + 1])
        {
            swap(nums, i, i + 1)
        }
        i ← i + 1
    }
}
DISPLAY(nums)
`,
  },
  {
    name: 'Recursion: factorial',
    code: `PROCEDURE factorial(n)
{
    IF (n ≤ 1)
    {
        RETURN(1)
    }
    RETURN(n * factorial(n - 1))
}

DISPLAY(factorial(5))
`,
  },
  {
    name: 'Guess the number',
    code: `secret ← RANDOM(1, 20)
guess ← 0
tries ← 0
REPEAT UNTIL (guess = secret)
{
    DISPLAY("Guess a number from 1 to 20:")
    guess ← INPUT()
    tries ← tries + 1
    IF (guess < secret)
    {
        DISPLAY("Too low!")
    }
    ELSE
    {
        IF (guess > secret)
        {
            DISPLAY("Too high!")
        }
    }
}
DISPLAY("Got it in")
DISPLAY(tries)
`,
  },
  {
    name: 'Trace it: mystery loop',
    code: `// Practice tracing: turn on Practice in the Trace tab,
// press Build table, and fill in every value.
x ← 1
y ← 10
REPEAT UNTIL (x ≥ y)
{
    x ← x * 2
    y ← y - 1
}
DISPLAY(x)
DISPLAY(y)
`,
  },
  {
    name: 'Trace it: mystery procedure',
    code: `// What does mystery do? Trace it to find out.
PROCEDURE mystery(list)
{
    result ← 0
    FOR EACH n IN list
    {
        IF (n MOD 2 = 0)
        {
            result ← result + n
        }
    }
    RETURN(result)
}

nums ← [3, 8, 5, 4, 10]
DISPLAY(mystery(nums))
`,
  },
  {
    name: 'Robot: reach the goal',
    world: 'Exam-style 5×5',
    code: `// The robot (triangle) must reach the gray square.
REPEAT 3 TIMES
{
    MOVE_FORWARD()
}
ROTATE_RIGHT()
MOVE_FORWARD()
ROTATE_LEFT()
MOVE_FORWARD()
`,
  },
  {
    name: 'Robot: follow the corridor',
    world: 'Corridor',
    code: `// Go forward when you can; otherwise turn (left first).
REPEAT 30 TIMES
{
    IF (CAN_MOVE(forward))
    {
        MOVE_FORWARD()
    }
    ELSE
    {
        IF (CAN_MOVE(left))
        {
            ROTATE_LEFT()
        }
        ELSE
        {
            ROTATE_RIGHT()
        }
    }
}
`,
  },
  {
    name: 'Robot: right-hand maze',
    world: 'Maze 7×7',
    code: `// Right-hand rule: always prefer turning right.
REPEAT 80 TIMES
{
    IF (CAN_MOVE(right))
    {
        ROTATE_RIGHT()
        MOVE_FORWARD()
    }
    ELSE
    {
        IF (CAN_MOVE(forward))
        {
            MOVE_FORWARD()
        }
        ELSE
        {
            ROTATE_LEFT()
        }
    }
}
`,
  },
];
