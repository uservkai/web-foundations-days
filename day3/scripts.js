let notes = [
    { id: 1, text: "Buy milk and bread", category: "personal" },
    { id: 2, text: "Finish the Day 3 assignment", category: "study" },
    { id: 3, text: "Email the project report to Grace", category: "work" },
    { id: 4, text: "Revise JavaScript arrays", category: "study" },
    { id: 5, text: "Call mum", category: "personal" },
];

const categories = ["personal", "work", "study"];

// Function 1: searchnotes and convert to lowercase
function searchNotes(word) {
    const lowerCaseWord = word.toLowerCase();
    return notes.filter(note => note.text.toLowerCase().includes(lowerCaseWord));
}
// ------Test------
console.log(searchNotes("milk"));  // [ { id: 1, text: 'Buy milk and bread', category: 'personal' } ]
console.log(searchNotes("red"));   // []

// Longest note
function longestNote() {
    if (notes.length === 0) {
        return null;
    }

    let longest = notes[0];
    for (const note of notes) {
        if (note.text.length > longest.text.length) {
            longest = note;
        }
    }

    return longest;
}

//-----Test-----
console.log(longestNote()); // { id: 3, text: 'Email the project report to Grace', category: 'work' }

let originalNotes = notes;
notes = [];
console.log(longestNote()); // null

notes = originalNotes

//countByCategory
function countByCategory() {
    const counts = {personal: 0, work: 0, study: 0};
    
    for (const note of notes) {
        counts[note.category]++;
    }

    return counts; 
}

//----Test----
console.log(countByCategory()); // { personal: 2, work: 1, study: 2 }

//getSummary
function getSummary() {
    const counts = countByCategory();
    const word = notes.length === 1 ? "note" : "notes";

    return `${notes.length} ${word}: ${counts.personal} personal, ${counts.work} work, ${counts.study} study.`;
}

//----Test
console.log(getSummary()); // 5 notes: 2 personal, 1 work, 2 study.

//isDuplicate
const isDuplicate = (text) => {
    const clean = text.trim().toLowerCase();

    return notes.some(note => note.text.trim().toLowerCase() === clean);
}
//----Test
console.log(isDuplicate("call mum")); // true
console.log(isDuplicate("the"));  // false

//addNote
const addNote = (text, category) => {
    if (text.length < 1 || text.length > 200) {
        return false;
    }

    if (!categories.includes(category)) {
        console.log(`Failed: '${category}' is not a valid category.`);
        return false;
    }

    if (isDuplicate(text)) {
        console.log(`Failed: A note with this text already exists.`);
        return false;
    }

    const nextId = notes.length > 0 ? notes[notes.length -1].id + 1 : 1;

    notes.push({id: nextId, text: text, category: category});
    console.log("Success: Note added successfully.");
    return true;
};

//----Test
console.log(addNote("Call Mum", "personal"));  // Failed: A note with this text already exists.,false
console.log(addNote("Go for a run", "personal"));  // Success: Note added successfully., true 
console.log(addNote("Call Mum", "work")); //Failed: A note with this text already exists., false