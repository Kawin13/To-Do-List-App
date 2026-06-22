/**
 * TASKFLOW — app.js
 * ==================
 * A production-quality To-Do list application.
 *
 * Architecture:
 *  - State  : Single source of truth (tasks array + activeFilter string)
 *  - Storage: localStorage helpers keep state persisted across sessions
 *  - Render : Pure render pipeline — state → DOM (no partial patching)
 *  - Events : Event delegation on the task list container (O(1) listeners)
 *
 * CRUD:
 *  Create  → addTask()
 *  Read    → renderTasks()  (called on every state change)
 *  Update  → toggleComplete(), saveEdit()
 *  Delete  → deleteTask()
 */

'use strict';

/* ============================================================
   1. CONSTANTS & INITIAL STATE
   ============================================================ */

const STORAGE_KEY = 'taskflow_tasks';

/**
 * Application state object.
 * @type {{ tasks: Task[], activeFilter: 'all'|'active'|'completed' }}
 *
 * @typedef {{ id: string, text: string, completed: boolean, createdAt: number }} Task
 */
const state = {
  tasks: [],
  activeFilter: 'all',
};


/* ============================================================
   2. LOCAL STORAGE HELPERS
   ============================================================ */

/**
 * Persist current tasks array to localStorage.
 * Called after every state mutation.
 */
function saveTasks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
  } catch (err) {
    // Storage may be unavailable (private mode quota exceeded, etc.)
    console.warn('[Taskflow] Could not save to localStorage:', err);
  }
}

/**
 * Hydrate state.tasks from localStorage on app boot.
 * Falls back to an empty array if nothing is stored or JSON is malformed.
 */
function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state.tasks = raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn('[Taskflow] Could not load from localStorage:', err);
    state.tasks = [];
  }
}


/* ============================================================
   3. UNIQUE ID GENERATOR
   ============================================================ */

/**
 * Generate a collision-resistant ID using crypto.randomUUID when available,
 * falling back to a timestamp + random suffix.
 * @returns {string}
 */
function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}


/* ============================================================
   4. STATE MUTATION FUNCTIONS
   ============================================================ */

/**
 * Create a new task and prepend it to state.
 * @param {string} text - Validated, trimmed task description.
 */
function addTask(text) {
  /** @type {Task} */
  const task = {
    id:        generateId(),
    text:      text.trim(),
    completed: false,
    createdAt: Date.now(),
  };

  state.tasks.unshift(task); // newest tasks appear at the top
  saveTasks();
  renderTasks();
  updateStats();
}

/**
 * Toggle the completed status of a task by id.
 * @param {string} id
 */
function toggleComplete(id) {
  const task = findTask(id);
  if (!task) return;

  task.completed = !task.completed;
  saveTasks();
  renderTasks();
  updateStats();
}

/**
 * Persist an edited task's new text.
 * Ignores the update if the new text is empty (keeps old text).
 * @param {string} id
 * @param {string} newText
 */
function saveEdit(id, newText) {
  const trimmed = newText.trim();
  if (!trimmed) return; // don't allow blank tasks via edit

  const task = findTask(id);
  if (!task) return;

  task.text = trimmed;
  saveTasks();
  renderTasks();
}

/**
 * Remove a task by id after a brief exit animation.
 * @param {string} id
 * @param {HTMLElement} itemEl - The DOM element to animate out.
 */
function deleteTask(id, itemEl) {
  // Trigger CSS exit animation first
  itemEl.classList.add('removing');

  // Remove from state after animation completes (~220ms)
  setTimeout(() => {
    state.tasks = state.tasks.filter(t => t.id !== id);
    saveTasks();
    renderTasks();
    updateStats();
  }, 210);
}

/**
 * Remove all completed tasks in one operation.
 */
function clearCompleted() {
  state.tasks = state.tasks.filter(t => !t.completed);
  saveTasks();
  renderTasks();
  updateStats();
}

/**
 * Lookup helper — find a task by id.
 * @param {string} id
 * @returns {Task|undefined}
 */
function findTask(id) {
  return state.tasks.find(t => t.id === id);
}


/* ============================================================
   5. FILTER FUNCTIONS
   ============================================================ */

/**
 * Return the subset of tasks matching the current filter.
 * @returns {Task[]}
 */
function getFilteredTasks() {
  switch (state.activeFilter) {
    case 'active':    return state.tasks.filter(t => !t.completed);
    case 'completed': return state.tasks.filter(t =>  t.completed);
    default:          return state.tasks; // 'all'
  }
}

/**
 * Change the active filter and re-render.
 * @param {'all'|'active'|'completed'} filter
 */
function setFilter(filter) {
  state.activeFilter = filter;
  updateFilterButtons();
  renderTasks();
}


/* ============================================================
   6. RENDER FUNCTIONS
   ============================================================ */

/** Cache DOM references to avoid repeated querySelector calls. */
const dom = {
  taskList:          document.getElementById('task-list'),
  emptyState:        document.getElementById('empty-state'),
  taskInput:         document.getElementById('task-input'),
  inputError:        document.getElementById('input-error'),
  tasksRemaining:    document.getElementById('tasks-remaining'),
  clearCompletedBtn: document.getElementById('clear-completed-btn'),
  addBtn:            document.getElementById('add-btn'),
  filterBtns:        document.querySelectorAll('.filter-btn'),
};

/**
 * Build the HTML string for a single task item.
 * Using innerHTML template strings is safe here because all user text
 * is escaped via escapeHtml() before insertion.
 *
 * @param {Task} task
 * @returns {string} HTML string
 */
function buildTaskHTML(task) {
  const safeText = escapeHtml(task.text);
  const completedClass = task.completed ? 'completed' : '';
  const checkedAttr    = task.completed ? 'checked'   : '';

  return `
    <li
      class="task-item ${completedClass}"
      data-id="${task.id}"
      role="listitem"
    >
      <!-- Checkbox -->
      <div class="task-checkbox-wrap">
        <input
          type="checkbox"
          class="task-checkbox"
          ${checkedAttr}
          aria-label="Mark '${safeText}' as ${task.completed ? 'incomplete' : 'complete'}"
          data-action="toggle"
        />
      </div>

      <!-- Text (click to start inline edit) -->
      <span
        class="task-text"
        data-action="start-edit"
        title="Click to edit"
        role="button"
        tabindex="0"
        aria-label="Edit task: ${safeText}"
      >${safeText}</span>

      <!-- Action buttons -->
      <div class="task-actions" aria-label="Task actions">
        <button
          class="task-action-btn edit"
          data-action="start-edit"
          aria-label="Edit task"
          title="Edit"
        >✎</button>
        <button
          class="task-action-btn delete"
          data-action="delete"
          aria-label="Delete task"
          title="Delete"
        >✕</button>
      </div>
    </li>
  `;
}

/**
 * Main render function.
 * Rebuilds the task list from scratch based on current filtered state.
 * Called after every state mutation.
 */
function renderTasks() {
  const filtered = getFilteredTasks();

  if (filtered.length === 0) {
    dom.taskList.innerHTML = '';
    dom.emptyState.hidden  = false;
    return;
  }

  dom.emptyState.hidden = true;
  // Build all HTML in one pass, then set innerHTML once (minimal reflow)
  dom.taskList.innerHTML = filtered.map(buildTaskHTML).join('');
}

/**
 * Update the "N tasks left" counter and the clear-completed button visibility.
 */
function updateStats() {
  const remaining = state.tasks.filter(t => !t.completed).length;
  const total     = state.tasks.length;

  dom.tasksRemaining.textContent =
    `${remaining} task${remaining !== 1 ? 's' : ''} left`;

  const hasCompleted = state.tasks.some(t => t.completed);
  dom.clearCompletedBtn.style.visibility = hasCompleted ? 'visible' : 'hidden';
}

/**
 * Sync the filter button active states with state.activeFilter.
 */
function updateFilterButtons() {
  dom.filterBtns.forEach(btn => {
    const isActive = btn.dataset.filter === state.activeFilter;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });
}


/* ============================================================
   7. INLINE EDIT HELPERS
   ============================================================ */

/**
 * Replace a task's <span> with a focused <input> for inline editing.
 * @param {HTMLElement} taskItem  - The .task-item li element.
 * @param {string}      id        - Task id.
 * @param {string}      currentText
 */
function startInlineEdit(taskItem, id, currentText) {
  // Don't open a second input if one is already open
  if (taskItem.querySelector('.task-edit-input')) return;

  const span = taskItem.querySelector('.task-text');
  if (!span) return;

  // Build edit input
  const input = document.createElement('input');
  input.type       = 'text';
  input.className  = 'task-edit-input';
  input.value      = currentText;
  input.maxLength  = 200;
  input.setAttribute('aria-label', 'Edit task text');

  // Replace the span with the input
  span.replaceWith(input);
  input.focus();
  input.select();

  /**
   * Commit edit on blur or Enter.
   * @param {Event} e
   */
  function commitEdit(e) {
    // Prevent double-fire (blur fires after keydown in some browsers)
    input.removeEventListener('blur',    commitEdit);
    input.removeEventListener('keydown', handleEditKey);

    const newText = input.value.trim();
    if (newText && newText !== currentText) {
      saveEdit(id, newText);
    } else {
      // Restore original span if nothing changed or input is empty
      renderTasks();
    }
  }

  /**
   * Keyboard handling inside the edit input.
   * @param {KeyboardEvent} e
   */
  function handleEditKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur(); // triggers commitEdit via blur
    }
    if (e.key === 'Escape') {
      input.removeEventListener('blur',    commitEdit);
      input.removeEventListener('keydown', handleEditKey);
      renderTasks(); // cancel — restore original
    }
  }

  input.addEventListener('blur',    commitEdit);
  input.addEventListener('keydown', handleEditKey);
}


/* ============================================================
   8. INPUT VALIDATION
   ============================================================ */

/**
 * Show or clear the input validation error message.
 * @param {string} message - Empty string clears the error.
 */
function setInputError(message) {
  dom.inputError.textContent = message;
}

/**
 * Read and validate the task input field.
 * @returns {string|null} Trimmed text, or null if invalid.
 */
function readAndValidateInput() {
  const value = dom.taskInput.value.trim();

  if (!value) {
    setInputError('Task description cannot be empty.');
    dom.taskInput.focus();
    return null;
  }

  // Guard against duplicate tasks (optional UX nicety)
  const isDuplicate = state.tasks.some(
    t => t.text.toLowerCase() === value.toLowerCase()
  );
  if (isDuplicate) {
    setInputError('This task already exists.');
    dom.taskInput.focus();
    return null;
  }

  setInputError(''); // clear any previous error
  return value;
}


/* ============================================================
   9. SECURITY HELPER
   ============================================================ */

/**
 * Escape HTML special characters to prevent XSS.
 * Necessary because we use innerHTML to render task text.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return str.replace(/[&<>"']/g, ch => map[ch]);
}


/* ============================================================
   10. EVENT HANDLERS
   ============================================================ */

/**
 * Handle "Add Task" — triggered by button click or Enter key.
 */
function handleAdd() {
  const text = readAndValidateInput();
  if (!text) return;

  addTask(text);
  dom.taskInput.value = '';
  dom.taskInput.focus();
}

/**
 * EVENT DELEGATION on the task list.
 *
 * Instead of attaching listeners to each task item (which are recreated on
 * every render), we listen on the static parent container and check what was
 * clicked via closest() + data-action attributes.
 *
 * This is O(1) listener overhead regardless of task count.
 *
 * @param {MouseEvent} e
 */
function handleTaskListClick(e) {
  // Find the closest element with a data-action attribute
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  // Walk up to find the parent task item
  const taskItem = actionEl.closest('.task-item');
  if (!taskItem) return;

  const id     = taskItem.dataset.id;
  const action = actionEl.dataset.action;

  if (action === 'toggle') {
    toggleComplete(id);
    return;
  }

  if (action === 'delete') {
    deleteTask(id, taskItem);
    return;
  }

  if (action === 'start-edit') {
    const task = findTask(id);
    if (!task || task.completed) return; // don't edit completed tasks
    startInlineEdit(taskItem, id, task.text);
    return;
  }
}

/**
 * Keyboard accessibility: allow Enter/Space on the task-text span
 * to trigger inline edit (matches its role="button").
 * @param {KeyboardEvent} e
 */
function handleTaskListKeydown(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;

  const actionEl = e.target.closest('[data-action="start-edit"]');
  if (!actionEl) return;

  e.preventDefault();
  const taskItem = actionEl.closest('.task-item');
  if (!taskItem) return;

  const id   = taskItem.dataset.id;
  const task = findTask(id);
  if (!task || task.completed) return;

  startInlineEdit(taskItem, id, task.text);
}

/**
 * Wire up all static event listeners.
 * (Dynamic task events are handled via delegation above.)
 */
function bindEvents() {
  // Add task — button click
  dom.addBtn.addEventListener('click', handleAdd);

  // Add task — Enter key in input field
  dom.taskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
    // Clear the error as soon as the user starts typing again
    if (dom.inputError.textContent) setInputError('');
  });

  // Event delegation on the task list (covers toggle, delete, edit)
  dom.taskList.addEventListener('click',   handleTaskListClick);
  dom.taskList.addEventListener('keydown', handleTaskListKeydown);

  // Filter buttons
  dom.filterBtns.forEach(btn => {
    btn.addEventListener('click', () => setFilter(btn.dataset.filter));
  });

  // Clear completed button
  dom.clearCompletedBtn.addEventListener('click', clearCompleted);
}


/* ============================================================
   11. INITIALISATION
   ============================================================ */

/**
 * Boot the application.
 * Called once the DOM is ready.
 */
function init() {
  loadTasks();       // hydrate state from localStorage
  renderTasks();     // paint initial UI
  updateStats();     // set counter
  updateFilterButtons(); // reflect any persisted filter (none yet, but future-proof)
  bindEvents();      // attach all listeners
}

// Kick off — DOM is already parsed since this script is at bottom of <body>
init();
