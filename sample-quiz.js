// A built-in sample quiz for trying things out without filling in a quiz file.
// This file is part of the public website, so it must never hold real quiz questions.
// The 9-round layout: standard rounds 1, 3, 5, 7 and 9, with the newer round types in between.
window.WQ_SAMPLE_QUIZ = {
  title: "Sample quiz",
  teams: ["The Quizzly Bears", "Les Quizerables", "The Know-It-Owls", "Smartie Pints"],
  rounds: [
    { num: 1, topic: "Geography", type: "mc", mode: "agree", questions: [
      { text: "What is the longest river in Ireland?", options: ["Shannon", "Liffey", "Boyne", "Barrow"], answer: "A", seconds: 20 },
      { text: "Which county is known as 'the Kingdom'?", options: ["Cork", "Kerry", "Clare", "Galway"], answer: "B", seconds: 20 }
    ]},
    { num: 2, topic: "Pin the tail on the donkey", type: "pin", mode: "first", questions: [
      { kind: "pin", text: "Put Carlow town on the map of Ireland.", picture: "ireland-map.svg",
        target: { x: 69.5, y: 63.4 }, level: "medium", marker: "pin", seconds: 30 },
      { kind: "pin", text: "The snowman has lost his nose! Put the carrot back where it belongs.", picture: "snowman.svg",
        target: { x: 50, y: 26.2 }, level: "hard", marker: "carrot", seconds: 20, full: "snowman-nose.svg", showFor: 4 }
    ]},
    { num: 3, topic: "Science", type: "mc", mode: "agree", questions: [
      { text: "What is the chemical symbol for gold?", options: ["Ag", "Au", "Gd", "Go"], answer: "B", seconds: 20 },
      { text: "True or false: sound travels faster in water than in air.", options: ["True", "False"], answer: "A", seconds: 15 }
    ]},
    { num: 4, topic: "Put them in order", type: "order", mode: "first", questions: [
      { kind: "order", text: "Put these in order of when they were built, oldest first.",
        items: ["Newgrange", "The Great Pyramid of Giza", "The Colosseum", "The Eiffel Tower"], top: "Oldest", bottom: "Newest", seconds: 30,
        note: "Newgrange (about 3200 BC) is a few hundred years older than the Great Pyramid (about 2560 BC)." },
      { kind: "order", text: "Put these counties in order of size, biggest first.",
        items: ["Cork", "Galway", "Mayo", "Donegal"], top: "Biggest", bottom: "Smallest", seconds: 30 }
    ]},
    { num: 5, topic: "Sport", type: "mc", mode: "agree", questions: [
      { text: "How many players does a Gaelic football team have on the pitch?", options: ["11", "13", "15", "18"], answer: "C", seconds: 20 },
      { text: "In which sport would you see a 'slam dunk'?", options: ["Volleyball", "Basketball", "Tennis", "Handball"], answer: "B", seconds: 20 }
    ]},
    { num: 6, topic: "Guess the year", type: "year", mode: "first", questions: [
      { kind: "year", text: "Song 1: what year did this song come out?", answer: 1994, start: 2000, listen: true, seconds: 20,
        note: "Zombie, The Cranberries (1994). In the sample, play it yourself or any song you know the year of." },
      { kind: "year", text: "In what year did people first walk on the Moon?", answer: 1969, start: 2000, listen: false, seconds: 20,
        note: "Apollo 11, July 1969." }
    ]},
    { num: 7, topic: "History", type: "mc", mode: "agree", questions: [
      { text: "In what year did the Easter Rising take place?", options: ["1914", "1916", "1921", "1922"], answer: "B", seconds: 20 },
      { text: "Who was the first woman to win a Nobel Prize?", options: ["Marie Curie", "Ada Lovelace", "Florence Nightingale", "Rosalind Franklin"], answer: "A", seconds: 20 }
    ]},
    { num: 8, topic: "Resize", type: "resize", mode: "first", questions: [
      { kind: "resize", text: "A giraffe has come to visit Santa! Make Santa the right size next to it.",
        picture: "giraffe.svg", moving: "santa.svg", size: 5, movingSize: 1.8, level: "easy", seconds: 30,
        note: "A tall giraffe stands about 5 m to the top of its head, nearly three Santas." }
    ]},
    { num: 9, topic: "Final round: mixed bag", type: "mc", mode: "agree", questions: [
      { text: "How many days are there in a leap year?", options: ["364", "365", "366", "367"], answer: "C", seconds: 20 },
      { text: "What colour do you get by mixing blue and yellow?", options: ["Green", "Purple", "Orange", "Brown"], answer: "A", seconds: 20 }
    ]}
  ]
};
