const API_URL = "https://jsonplaceholder.typicode.com/users";

const loadButton = document.getElementById("load-users");
const filterInput = document.getElementById("filter-input");
const statusEl = document.getElementById("status");
const usersList = document.getElementById("users-list");

// All users loaded from the API (the filter never re-fetches).
let allUsers = [];

// Draws any array of users into the list.
function renderUsers(list) {
  usersList.replaceChildren();

  list.forEach((user) => {
    const li = document.createElement("li");

    const name = document.createElement("strong");
    name.textContent = user.name;

    const email = document.createElement("div");
    email.textContent = "Email: " + user.email;

    const city = document.createElement("div");
    city.textContent = "City: " + user.address.city;

    const company = document.createElement("div");
    company.textContent = "Company: " + user.company.name;

    li.append(name, email, city, company);
    usersList.appendChild(li);
  });
}

// Filters the stored array by the typed text (case-insensitive) and renders it.
function applyFilter() {
  const text = filterInput.value.trim().toLowerCase();
  const filtered = allUsers.filter((user) =>
    user.name.toLowerCase().includes(text)
  );

  renderUsers(filtered);

  if (allUsers.length === 0) {
    return;
  }
  if (filtered.length === 0) {
    statusEl.textContent = "No users match your filter.";
  } else {
    statusEl.textContent =
      "Showing " + filtered.length + " of " + allUsers.length + " users.";
  }
}

async function loadUsers() {
  loadButton.disabled = true;
  statusEl.textContent = "Loading users...";

  try {
    const response = await fetch(API_URL);
    if (!response.ok) {
      throw new Error("Request failed with status " + response.status);
    }
    allUsers = await response.json();
    applyFilter();
    if (allUsers.length > 0 && filterInput.value.trim() === "") {
      statusEl.textContent = "Loaded " + allUsers.length + " users.";
    }
  } catch (error) {
    statusEl.textContent = "Error: could not load users (" + error.message + ").";
  } finally {
    loadButton.disabled = false;
  }
}

loadButton.addEventListener("click", loadUsers);
filterInput.addEventListener("input", applyFilter);