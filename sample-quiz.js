// A built-in sample quiz for trying things out without filling in a quiz file.
// This file is part of the public website, so it must never hold real quiz questions.
window.WQ_SAMPLE_QUIZ = {
  title: "Sample quiz",
  teams: ["The Quizzly Bears", "Les Quizerables", "The Know-It-Owls", "Smartie Pints"],
  rounds: [
    { num: 1, topic: "Geography", type: "mc", mode: "first", questions: [
      { text: "What is the longest river in Ireland?", options: ["Shannon", "Liffey", "Boyne", "Barrow"], answer: "A", seconds: 20 },
      { text: "Which county is known as 'the Kingdom'?", options: ["Cork", "Kerry", "Clare", "Galway"], answer: "B", seconds: 20 }
    ]},
    { num: 2, topic: "Science", type: "mc", mode: "agree", questions: [
      { text: "What is the chemical symbol for gold?", options: ["Ag", "Au", "Gd", "Go"], answer: "B", seconds: 20 },
      { text: "True or false: sound travels faster in water than in air.", options: ["True", "False"], answer: "A", seconds: 15 }
    ]},
    { num: 3, topic: "Sport", type: "mc", mode: "first", questions: [
      { text: "How many players does a Gaelic football team have on the pitch?", options: ["11", "13", "15", "18"], answer: "C", seconds: 20 },
      { text: "In which sport would you see a 'slam dunk'?", options: ["Volleyball", "Basketball", "Tennis", "Handball"], answer: "B", seconds: 20 }
    ]},
    { num: 4, topic: "Pin the tail on the donkey", type: "pin", mode: "first", questions: [
      { kind: "pin", text: "Put Carlow town on the map of Ireland.", picture: "ireland-map.svg",
        target: { x: 69.5, y: 63.4 }, level: "medium", marker: "pin", seconds: 30 },
      { kind: "pin", text: "The snowman has lost his nose! Put the carrot back where it belongs.", picture: "snowman.svg",
        target: { x: 50, y: 26.2 }, level: "hard", marker: "carrot", seconds: 20, full: "snowman-nose.svg", showFor: 4 }
    ]},
    { num: 5, topic: "Food and drink", type: "mc", mode: "agree", questions: [
      { text: "Which country does feta cheese come from?", options: ["Italy", "Greece", "Turkey", "Spain"], answer: "B", seconds: 20 },
      { text: "What is the main ingredient of guacamole?", options: ["Avocado", "Peas", "Cucumber", "Lime"], answer: "A", seconds: 20 }
    ]},
    { num: 6, topic: "History", type: "mc", mode: "first", questions: [
      { text: "In what year did the Easter Rising take place?", options: ["1914", "1916", "1921", "1922"], answer: "B", seconds: 20 },
      { text: "Who was the first woman to win a Nobel Prize?", options: ["Marie Curie", "Ada Lovelace", "Florence Nightingale", "Rosalind Franklin"], answer: "A", seconds: 20 }
    ]},
    { num: 7, topic: "Music", type: "mc", mode: "agree", questions: [
      { text: "How many strings does a standard guitar have?", options: ["4", "5", "6", "7"], answer: "C", seconds: 20 },
      { text: "Which instrument usually has 88 keys?", options: ["Accordion", "Piano", "Harpsichord", "Xylophone"], answer: "B", seconds: 20 }
    ]},
    { num: 8, topic: "Nature", type: "mc", mode: "first", questions: [
      { text: "What is the largest animal on Earth?", options: ["African elephant", "Blue whale", "Giraffe", "Sperm whale"], answer: "B", seconds: 20 },
      { text: "True or false: a group of crows is called a 'murder'.", options: ["True", "False"], answer: "A", seconds: 15 }
    ]},
    { num: 9, topic: "Technology", type: "mc", mode: "agree", questions: [
      { text: "What does 'www' stand for in a web address?", options: ["World Wide Web", "World Web Window", "Wide Web World", "Web World Wide"], answer: "A", seconds: 20 },
      { text: "Which company makes the iPhone?", options: ["Samsung", "Google", "Apple", "Nokia"], answer: "C", seconds: 20 }
    ]},
    { num: 10, topic: "Final round: mixed bag", type: "mc", mode: "agree", questions: [
      { text: "How many days are there in a leap year?", options: ["364", "365", "366", "367"], answer: "C", seconds: 20 },
      { text: "What colour do you get by mixing blue and yellow?", options: ["Green", "Purple", "Orange", "Brown"], answer: "A", seconds: 20 }
    ]}
  ]
};
