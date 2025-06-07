// src/app.js

import { signIn, getUser } from './auth';
import { apiUrl, getUserFragments } from './api'; // <-- Added this line (Step 64)


async function init() {
  // Get our UI elements
  const userSection = document.querySelector('#user');
  const loginBtn = document.querySelector('#login');

  // Wire up event handlers to deal with login and logout.
  loginBtn.onclick = () => {
    // Sign-in via the Amazon Cognito Hosted UI (requires redirects)
    signIn();
  };

  // See if we're signed in (i.e., we'll have a `user` object)
  const user = await getUser();
  if (!user) {
    return;
  }

  // Update the UI to welcome the user
  userSection.hidden = false;

  // Show the user's username
  userSection.querySelector('.username').innerText = user.username;

  // Disable the Login button
  loginBtn.disabled = true;

  // ✅ Step 64: Get user fragments and log result
  const userFragments = await getUserFragments(user);
  const form = document.querySelector('#fragmentForm');
  const textarea = document.querySelector('#fragmentContent');
  const fragmentsList = document.querySelector('#fragments');

  form.onsubmit = async (e) => {
    e.preventDefault();
    const content = textarea.value.trim();
    if (!content) return;

    // POST /v1/fragments
    const res = await fetch(`${apiUrl}/v1/fragments`, {
      method: 'POST',
      headers: user.authorizationHeaders('text/plain'),
      body: content,
    });

    if (res.ok) {
      const result = await res.json();
      console.log('New fragment created:', result);

      const li = document.createElement('li');
      li.textContent = `${result.fragment.id} - ${result.fragment.type}`;
      fragmentsList.appendChild(li);
      textarea.value = '';
    } else {
      alert('Failed to create fragment');
    }
  };

  // Show existing fragments
  const fragmentsData = await getUserFragments(user);
  if (fragmentsData && fragmentsData.fragments) {
    fragmentsData.fragments.forEach((id) => {
      const li = document.createElement('li');
      li.textContent = id;
      fragmentsList.appendChild(li);
    });
  }

  // (Optional for now) You can log or use them
  // console.log('Fragments:', userFragments);
}

// Wait for the DOM to be ready, then start the app
addEventListener('DOMContentLoaded', init);
