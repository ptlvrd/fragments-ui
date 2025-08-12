// src/app.js
import { signIn, getUser } from './auth.js';
import { apiUrl, getUserFragments } from './api.js';
import { offlineStorage, isOnline } from './offline.js';

// Global variables for DOM elements
let textarea, typeSelect, textInput, fileInput, imageUpload;

async function init() {
  // Get DOM elements
  const user = document.getElementById('user');
  const loginBtn = document.getElementById('loginBtn');
  const fragmentsList = document.getElementById('fragmentsList');
  const form = document.getElementById('fragmentForm');
  textarea = document.getElementById('fragmentContent');
  typeSelect = document.getElementById('fragmentType');
  textInput = document.getElementById('textInput');
  fileInput = document.getElementById('fragmentFile');
  imageUpload = document.getElementById('imageUpload');

  // Check if user is already signed in
  const currentUser = await getUser();
  if (currentUser) {
    user.hidden = false;
    loginBtn.hidden = true;
    user.querySelector('.username').innerText = currentUser.username;
    await displayFragments(currentUser);
  }

  // Login button click handler
  loginBtn.onclick = async () => {
    const user = await signIn();
    if (user) {
      loginBtn.hidden = true;
      user.hidden = false;
      user.querySelector('.username').innerText = user.username;
      await displayFragments(user);
    }
  };

  // Form submission handler
  form.onsubmit = async (e) => {
    e.preventDefault();
    const type = typeSelect.value;
    const file = fileInput.files[0];
    let body;

    if (file) {
      body = file;
    } else {
      const content = textarea.value.trim();
      if (!content) return;
      body = content;
    }

    let onlineCreationSuccess = false;

    // Check if we're online
    if (isOnline()) {
      try {
        const res = await fetch(`${apiUrl}/v1/fragments`, {
          method: 'POST',
          headers: currentUser.authorizationHeaders(type),
          body,
        });

        if (res.ok) {
          const fragment = await res.json();
          // Save to offline storage as backup
          await offlineStorage.saveFragment({
            ...fragment.fragment,
            ownerId: currentUser.username,
            pendingSync: false
          });
          
          clearFormSafely();
          await displayFragments(currentUser);
          onlineCreationSuccess = true;
        } else {
          throw new Error('Server error');
        }
      } catch (error) {
        console.warn('Online creation failed, saving offline:', error);
        // Fall through to offline creation
      }
    }

    // If offline or online creation failed, save locally
    if (!isOnline() || !onlineCreationSuccess) {
      const offlineId = `offline-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const offlineFragment = {
        id: offlineId,
        type: type,
        size: body.length || body.size || 0,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        ownerId: currentUser.username,
        pendingSync: true,
        data: body
      };

      await offlineStorage.saveFragment(offlineFragment);
      clearFormSafely();
      await displayFragments(currentUser);
      alert('Fragment saved offline. Will sync when online.');
    }
  };

  // Update offline status display
  updateOfflineStatus();
  window.addEventListener('online', updateOfflineStatus);
  window.addEventListener('offline', updateOfflineStatus);

  // Register service worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(registration => {
          console.log('SW registered: ', registration);
        })
        .catch(registrationError => {
          console.log('SW registration failed: ', registrationError);
        });
    });
  }
}

// Display fragments from both online and offline sources
async function displayFragments(user) {
  const fragments = [];
  
  try {
    // Get online fragments
    const onlineFragments = await getUserFragments(user);
    if (onlineFragments && onlineFragments.fragments) {
      fragments.push(...onlineFragments.fragments);
    }
  } catch (error) {
    console.warn('Failed to fetch online fragments:', error);
  }

  try {
    // Get offline fragments
    const offlineFragments = await offlineStorage.getAllFragments(user.username);
    fragments.push(...offlineFragments);
  } catch (error) {
    console.warn('Failed to fetch offline fragments:', error);
  }

  // Remove duplicates and sort by creation date
  const uniqueFragments = fragments.filter((fragment, index, self) => 
    index === self.findIndex(f => f.id === fragment.id)
  ).sort((a, b) => new Date(b.created) - new Date(a.created));

  const list = document.getElementById('fragments');
  list.innerHTML = '';

  uniqueFragments.forEach(fragment => {
    const li = document.createElement('li');
    const offlineStatus = fragment.pendingSync ? ' (Offline)' : '';
    li.innerHTML = `
      <strong>ID: ${fragment.id}</strong>${offlineStatus}<br>
      Type: ${fragment.type}<br>
      Size: ${fragment.size} bytes<br>
      Created: ${new Date(fragment.created).toLocaleString()}<br>
      <button onclick="showFragmentDetails('${fragment.id}')">View</button>
      <button onclick="updateFragment('${fragment.id}')">Edit</button>
      <button onclick="deleteFragment('${fragment.id}')">Delete</button>
      <button onclick="convertFragment('${fragment.id}')">Convert</button>
    `;
    list.appendChild(li);
  });
}

// Show fragment details
async function showFragmentDetails(id) {
  try {
    // Try to get from server first
    const user = await getUser();
    if (user && isOnline()) {
      try {
        const res = await fetch(`${apiUrl}/v1/fragments/${id}`, {
          headers: user.authorizationHeaders(),
        });
        if (res.ok) {
          const data = await res.text();
          alert(`Fragment ${id}:\n\n${data}`);
          return;
        }
      } catch (error) {
        console.warn('Failed to fetch from server:', error);
      }
    }

    // Fall back to offline storage
    const fragment = await offlineStorage.getFragment(id);
    if (fragment) {
      const data = fragment.data instanceof File ? 
        await fragment.data.text() : 
        fragment.data;
      alert(`Fragment ${id} (Offline):\n\n${data}`);
    } else {
      alert('Fragment not found');
    }
  } catch (error) {
    console.error('Error showing fragment details:', error);
    alert('Error showing fragment details');
  }
}

// Update fragment
async function updateFragment(id) {
  const newContent = prompt('Enter new content:');
  if (!newContent) return;

  try {
    const user = await getUser();
    if (!user) return;

    if (isOnline()) {
      // Try online update
      try {
        const res = await fetch(`${apiUrl}/v1/fragments/${id}`, {
          method: 'PUT',
          headers: user.authorizationHeaders('text/plain'),
          body: newContent,
        });
        if (res.ok) {
          // Update offline storage
          const fragment = await offlineStorage.getFragment(id);
          if (fragment) {
            fragment.data = newContent;
            fragment.updated = new Date().toISOString();
            fragment.pendingSync = false;
            await offlineStorage.saveFragment(fragment);
          }
          await displayFragments(user);
          alert('Fragment updated successfully');
          return;
        }
      } catch (error) {
        console.warn('Online update failed:', error);
      }
    }

    // Offline update
    const fragment = await offlineStorage.getFragment(id);
    if (fragment) {
      fragment.data = newContent;
      fragment.updated = new Date().toISOString();
      fragment.pendingSync = true;
      await offlineStorage.saveFragment(fragment);
      await displayFragments(user);
      alert('Fragment updated offline. Will sync when online.');
    }
  } catch (error) {
    console.error('Error updating fragment:', error);
    alert('Error updating fragment');
  }
}

// Delete fragment
async function deleteFragment(id) {
  if (!confirm('Are you sure you want to delete this fragment?')) return;

  try {
    const user = await getUser();
    if (!user) return;

    // Delete from offline storage first
    await offlineStorage.deleteFragment(id);

    // If online and not an offline fragment, delete from server
    if (isOnline() && !id.startsWith('offline-')) {
      try {
        const res = await fetch(`${apiUrl}/v1/fragments/${id}`, {
          method: 'DELETE',
          headers: user.authorizationHeaders(),
        });
        if (!res.ok) {
          console.warn('Server deletion failed:', res.status);
        }
      } catch (error) {
        console.warn('Failed to delete from server:', error);
      }
    }

    await displayFragments(user);
    alert('Fragment deleted');
  } catch (error) {
    console.error('Error deleting fragment:', error);
    alert('Error deleting fragment');
  }
}

// Convert fragment
async function convertFragment(id) {
  const targetType = prompt('Enter target type (e.g., .html, .md, .txt):');
  if (!targetType) return;

  try {
    const user = await getUser();
    if (!user) return;

    if (isOnline()) {
      // Try online conversion
      try {
        const res = await fetch(`${apiUrl}/v1/fragments/${id}${targetType}`, {
          headers: user.authorizationHeaders(),
        });
        if (res.ok) {
          const data = await res.text();
          alert(`Converted to ${targetType}:\n\n${data}`);
          return;
        }
      } catch (error) {
        console.warn('Online conversion failed:', error);
      }
    }

    // Basic offline conversion
    const fragment = await offlineStorage.getFragment(id);
    if (fragment) {
      let convertedData = fragment.data;
      
      if (fragment.type === 'text/markdown' && targetType === '.html') {
        // Simple markdown to HTML conversion
        convertedData = fragment.data
          .replace(/^### (.*$)/gim, '<h3>$1</h3>')
          .replace(/^## (.*$)/gim, '<h2>$1</h2>')
          .replace(/^# (.*$)/gim, '<h1>$1</h1>')
          .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
          .replace(/\*(.*)\*/gim, '<em>$1</em>')
          .replace(/\n/g, '<br>');
      } else if (fragment.type === 'text/html' && targetType === '.txt') {
        // Simple HTML to text conversion
        convertedData = fragment.data
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>');
      }
      
      alert(`Converted to ${targetType}:\n\n${convertedData}`);
    }
  } catch (error) {
    console.error('Error converting fragment:', error);
    alert('Error converting fragment');
  }
}

// Sync offline fragments when back online
async function syncOfflineFragments() {
  try {
    const user = await getUser();
    if (!user || !isOnline()) return;

    const pendingFragments = await offlineStorage.getPendingSyncFragments(user.username);
    if (pendingFragments.length === 0) {
      alert('No offline fragments to sync');
      return;
    }

    let syncedCount = 0;
    let failedCount = 0;

    for (const fragment of pendingFragments) {
      try {
        const res = await fetch(`${apiUrl}/v1/fragments`, {
          method: 'POST',
          headers: user.authorizationHeaders(fragment.type),
          body: fragment.data,
        });

        if (res.ok) {
          const newFragment = await res.json();
          // Update offline storage with server ID
          await offlineStorage.deleteFragment(fragment.id);
          await offlineStorage.saveFragment({
            ...newFragment.fragment,
            ownerId: user.username,
            pendingSync: false
          });
          syncedCount++;
        } else {
          failedCount++;
        }
      } catch (error) {
        console.error('Failed to sync fragment:', fragment.id, error);
        failedCount++;
      }
    }

    await displayFragments(user);
    alert(`Sync complete: ${syncedCount} synced, ${failedCount} failed`);
  } catch (error) {
    console.error('Error syncing offline fragments:', error);
    alert('Error syncing offline fragments');
  }
}

// Update offline status display
function updateOfflineStatus() {
  const status = document.getElementById('status');
  const offlineIndicator = document.getElementById('offlineIndicator');
  
  if (status) {
    status.textContent = isOnline() ? '🟢 Online' : '🔴 Offline';
  }
  
  if (offlineIndicator) {
    offlineIndicator.style.display = isOnline() ? 'none' : 'block';
  }
}

// Clear form safely
function clearFormSafely() {
  try {
    if (textarea) textarea.value = '';
    if (typeSelect) typeSelect.value = 'text/plain';
    if (textInput) textInput.style.display = 'block';
    if (fileInput) fileInput.value = '';
    if (imageUpload) imageUpload.style.display = 'none';
  } catch (error) {
    console.warn('Error clearing form:', error);
    // Fallback to form reset
    const form = document.getElementById('fragmentForm');
    if (form) form.reset();
  }
}

// Make functions globally available
window.showFragmentDetails = showFragmentDetails;
window.updateFragment = updateFragment;
window.deleteFragment = deleteFragment;
window.convertFragment = convertFragment;
window.manualSync = syncOfflineFragments;

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', init);
