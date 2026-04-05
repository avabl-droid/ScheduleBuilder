(function bootstrapFrontend() {
  const uiDayOrder = [
    { label: 'Monday', value: 1 },
    { label: 'Tuesday', value: 2 },
    { label: 'Wednesday', value: 3 },
    { label: 'Thursday', value: 4 },
    { label: 'Friday', value: 5 },
    { label: 'Saturday', value: 6 },
    { label: 'Sunday', value: 0 },
  ];
  
  const page = document.body.dataset.page;

  document.addEventListener('DOMContentLoaded', () => {
    attachLogoutLinks();

    const handlers = {
      auth: initAuthPage,
      login: initLoginPage,
      team: initTeamPage,
      availability: initAvailabilityPage,
      managerSchedule: initManagerSchedulePage,
      employeeSchedule: initEmployeeSchedulePage,
      constraints: initConstraintsPage,
      completeSetup: initCompleteSetupPage,
      redirectMain: initMainRedirectPage,
    };

    const handler = handlers[page];
    if (handler) {
      handler().catch((error) => {
        console.error(error);
        const statusNode = document.querySelector('[data-global-status]');
        if (statusNode) {
          setStatus(statusNode, error.message || 'Something went wrong.', 'error');
        }
      });
    }
  });

  async function apiRequest(path, options = {}) {
    const requestOptions = {
      method: options.method || 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    };

    if (options.body !== undefined) {
      requestOptions.headers['Content-Type'] = 'application/json';
      requestOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(path, requestOptions);
    const raw = await response.text();
    let payload = null;

    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch (error) {
        payload = { message: raw };
      }
    }

    if (!response.ok) {
      const message =
        payload?.error ||
        payload?.message ||
        `Request failed with status ${response.status}.`;
      const requestError = new Error(message);
      requestError.status = response.status;
      requestError.payload = payload;
      throw requestError;
    }

    return payload;
  }

  async function getCurrentSession() {
    try {
      return await apiRequest('/api/auth/session');
    } catch (error) {
      if (error.status === 401) {
        return null;
      }
      throw error;
    }
  }

  function getPrimaryMembership(session) {
    return session?.memberships?.[0] || null;
  }

  function isManager(session) {
    return session?.user?.systemRole === 'manager';
  }

  function redirectTo(url) {
    window.location.href = url;
  }

  function redirectForSession(session) {
    if (!session) {
      redirectTo('/indexSignUp.html');
      return;
    }

    if (session.user.requiresProfileCompletion) {
      redirectTo(`/profileSetupManager.html?userId=${encodeURIComponent(session.user.id)}`);
      return;
    }

    if (isManager(session)) {
      if (getPrimaryMembership(session)) {
        redirectTo('/mainSchedule.html');
      } else {
        redirectTo('/team.html');
      }
      return;
    }

    redirectTo('/employeeSchedule.html');
  }

  async function requireSession(options = {}) {
    const session = await getCurrentSession();

    if (!session) {
      redirectTo('/indexSignUp.html');
      throw new Error('Authentication required.');
    }

    if (options.managerOnly && !isManager(session)) {
      redirectTo('/employeeSchedule.html');
      throw new Error('Manager access required.');
    }

    hydrateShell(session);
    return session;
  }

  function hydrateShell(session) {
    document.querySelectorAll('[data-user-name]').forEach((node) => {
      node.textContent = session.user.fullName;
    });

    document.querySelectorAll('[data-user-role]').forEach((node) => {
      node.textContent = session.user.employmentRole || session.user.systemRole;
    });

    document.querySelectorAll('[data-manager-only]').forEach((node) => {
      node.hidden = !isManager(session);
    });

    document.querySelectorAll('[data-employee-only]').forEach((node) => {
      node.hidden = isManager(session);
    });
  }

  function attachLogoutLinks() {
    document.querySelectorAll('[data-action="logout"]').forEach((node) => {
      node.addEventListener('click', async (event) => {
        event.preventDefault();

        try {
          await apiRequest('/api/auth/logout', { method: 'POST' });
        } catch (error) {
          console.error(error);
        }

        redirectTo('/indexSignUp.html');
      });
    });
  }

  function setStatus(node, message, type) {
    if (!node) {
      return;
    }

    node.textContent = message || '';
    node.className = `status-message ${type ? `status-${type}` : ''}`;
    node.hidden = !message;
  }

  function parseQuery() {
    return new URLSearchParams(window.location.search);
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function addDays(dateString, days) {
    const date = new Date(`${dateString}T00:00:00`);
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function getWeekStart(dateString) {
    const date = new Date(`${dateString}T00:00:00`);
    const day = date.getDay();
    const diff = (day + 6) % 7;
    date.setDate(date.getDate() - diff);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function today() {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function formatDate(dateString) {
    return new Date(`${dateString}T00:00:00`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function formatWeekLabel(weekStartDate) {
    const weekEndDate = addDays(weekStartDate, 6);
    return `${formatDate(weekStartDate)} to ${formatDate(weekEndDate)}`;
  }

  function weekDates(weekStartDate) {
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(weekStartDate, index);
      return {
        date,
        label: new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
        }),
      };
    });
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function runWithOverride(executor, issueContainer) {
    try {
      return await executor();
    } catch (error) {
      if (error.status !== 409 || !error.payload?.overrideRequired) {
        throw error;
      }

      const messages = (error.payload.issues || [])
        .map((issue) => `- ${issue.message}`)
        .join('\n');

      if (issueContainer) {
        issueContainer.innerHTML = (error.payload.issues || [])
          .map((issue) => `<li>${escapeHtml(issue.message)}</li>`)
          .join('');
        issueContainer.hidden = !(error.payload.issues || []).length;
      }

      const password = window.prompt(
        `${error.payload.message}\n\n${messages}\n\nEnter your manager password to continue.`
      );

      if (!password) {
        return null;
      }

      return executor(password);
    }
  }

  function renderAvailabilityEditor(container, availability) {
    container.innerHTML = uiDayOrder
      .map((day) => {
        const entry =
          availability.find((item) => Number(item.dayOfWeek) === day.value) || {
            dayOfWeek: day.value,
            isAvailable: false,
            startTime: '',
            endTime: '',
          };

        return `
          <div class="day-editor">
            <label class="day-toggle">
              <input type="checkbox" data-day-available="${day.value}" ${
                entry.isAvailable ? 'checked' : ''
              }>
              <span>${day.label}</span>
            </label>
            <div class="day-times">
              <input type="time" data-day-start="${day.value}" value="${escapeHtml(
                entry.startTime || ''
              )}">
              <span>to</span>
              <input type="time" data-day-end="${day.value}" value="${escapeHtml(
                entry.endTime || ''
              )}">
            </div>
          </div>
        `;
      })
      .join('');
  }

  function collectAvailability(container) {
    return uiDayOrder.map((day) => {
      const isAvailable = container.querySelector(
        `[data-day-available="${day.value}"]`
      ).checked;
      const startTime = container.querySelector(`[data-day-start="${day.value}"]`).value;
      const endTime = container.querySelector(`[data-day-end="${day.value}"]`).value;

      return {
        dayOfWeek: day.value,
        isAvailable,
        startTime: isAvailable ? startTime : null,
        endTime: isAvailable ? endTime : null,
      };
    });
  }

  function createDayRowsHtml(prefix, values) {
    return uiDayOrder
      .map((day) => {
        const entry =
          values.find((item) => Number(item.dayOfWeek) === day.value) || {
            dayOfWeek: day.value,
            isOpen: false,
            startTime: '',
            endTime: '',
          };

        return `
          <div class="day-editor">
            <label class="day-toggle">
              <input type="checkbox" data-${prefix}-open="${day.value}" ${
                entry.isOpen ? 'checked' : ''
              }>
              <span>${day.label}</span>
            </label>
            <div class="day-times">
              <input type="time" data-${prefix}-start="${day.value}" value="${escapeHtml(
                entry.startTime || ''
              )}">
              <span>to</span>
              <input type="time" data-${prefix}-end="${day.value}" value="${escapeHtml(
                entry.endTime || ''
              )}">
            </div>
          </div>
        `;
      })
      .join('');
  }

  function collectBusinessHours(container) {
    return uiDayOrder.map((day) => {
      const isOpen = container.querySelector(`[data-business-open="${day.value}"]`).checked;
      const startTime = container.querySelector(`[data-business-start="${day.value}"]`).value;
      const endTime = container.querySelector(`[data-business-end="${day.value}"]`).value;

      return {
        dayOfWeek: day.value,
        isOpen,
        startTime: isOpen ? startTime : null,
        endTime: isOpen ? endTime : null,
      };
    });
  }

  function renderRoleRequirementRows(container, requirements) {
    const rows = requirements.length
      ? requirements
      : [{ roleName: '', dayOfWeek: '', startTime: '', endTime: '', minEmployees: 1 }];

    container.innerHTML = rows
      .map(
        (requirement, index) => `
          <div class="requirement-row" data-requirement-row="${index}">
            <input type="text" data-role-name value="${escapeHtml(
              requirement.roleName || ''
            )}" placeholder="Role name">
            <select data-role-day>
              <option value="">Any day</option>
              ${uiDayOrder
                .map(
                  (day) => `
                    <option value="${day.value}" ${
                      String(requirement.dayOfWeek) === String(day.value) ? 'selected' : ''
                    }>${day.label}</option>
                  `
                )
                .join('')}
            </select>
            <input type="time" data-role-start value="${escapeHtml(requirement.startTime || '')}">
            <input type="time" data-role-end value="${escapeHtml(requirement.endTime || '')}">
            <input type="number" min="1" data-role-min value="${escapeHtml(
              requirement.minEmployees || 1
            )}">
            <button type="button" class="secondary-btn" data-remove-role-row>Remove</button>
          </div>
        `
      )
      .join('');

    container.querySelectorAll('[data-remove-role-row]').forEach((button) => {
      button.addEventListener('click', () => {
        button.closest('.requirement-row').remove();
      });
    });
  }

  function collectRoleRequirements(container) {
    return Array.from(container.querySelectorAll('.requirement-row'))
      .map((row) => ({
        roleName: row.querySelector('[data-role-name]').value.trim(),
        dayOfWeek: row.querySelector('[data-role-day]').value,
        startTime: row.querySelector('[data-role-start]').value,
        endTime: row.querySelector('[data-role-end]').value,
        minEmployees: Number(row.querySelector('[data-role-min]').value || 1),
      }))
      .filter((entry) => entry.roleName);
  }

  function renderShiftRows(tbody, shifts, managerMode) {
    if (!shifts.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="${managerMode ? 6 : 4}" class="empty-row">No shifts scheduled this week.</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = shifts
      .map(
        (shift) => `
          <tr>
            <td>${escapeHtml(formatDate(shift.shiftDate))}</td>
            <td>${escapeHtml(`${shift.startTime} - ${shift.endTime}`)}</td>
            <td>${escapeHtml(shift.fullName || shift.username || 'You')}</td>
            <td>${escapeHtml(shift.employmentRole || '')}</td>
            ${
              managerMode
                ? `
                  <td><button type="button" class="secondary-btn" data-edit-shift="${shift.id}">Edit</button></td>
                  <td><button type="button" class="danger-btn" data-delete-shift="${shift.id}">Delete</button></td>
                `
                : ''
            }
          </tr>
        `
      )
      .join('');
  }

  function renderWeekCards(container, shifts, totals, weekStartDate, userId) {
    const shiftsByDate = new Map();
    shifts.forEach((shift) => {
      const list = shiftsByDate.get(shift.shiftDate) || [];
      list.push(shift);
      shiftsByDate.set(shift.shiftDate, list);
    });

    container.innerHTML = weekDates(weekStartDate)
      .map(({ date, label }) => {
        const dateShifts = shiftsByDate.get(date) || [];
        return `
          <section class="day-card">
            <h3>${escapeHtml(label)}</h3>
            ${
              dateShifts.length
                ? `<ul class="shift-list">
                    ${dateShifts
                      .map(
                        (shift) => `
                          <li>
                            <strong>${escapeHtml(`${shift.startTime} - ${shift.endTime}`)}</strong>
                            <span>${escapeHtml(
                              userId ? shift.employmentRole : `${shift.fullName} (${shift.employmentRole})`
                            )}</span>
                          </li>
                        `
                      )
                      .join('')}
                  </ul>`
                : '<p class="muted">No shifts scheduled.</p>'
            }
          </section>
        `;
      })
      .join('');

    if (totals) {
      const totalNode = document.querySelector('[data-weekly-totals]');
      if (totalNode) {
        totalNode.innerHTML = totals.length
          ? totals
              .map(
                (entry) => `
                  <li>${escapeHtml(entry.fullName)}: ${escapeHtml(entry.totalHours)} hours</li>
                `
              )
              .join('')
          : '<li>No hours scheduled yet.</li>';
      }
    }
  }

  async function initAuthPage() {
    const session = await getCurrentSession();
    if (session) {
      redirectForSession(session);
      return;
    }

    const signupForm = document.getElementById('managerSignupForm');
    const managerLoginForm = document.getElementById('managerLoginForm');
    const employeeLoginForm = document.getElementById('employeeLoginForm');

    signupForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const statusNode = document.getElementById('managerSignupStatus');

      const password = document.getElementById('signupPassword').value;
      const confirmPassword = document.getElementById('signupPasswordConfirm').value;

      if (password !== confirmPassword) {
        setStatus(statusNode, 'Passwords do not match.', 'error');
        return;
      }

      try {
        setStatus(statusNode, 'Creating your manager account...', 'info');
        await apiRequest('/api/auth/register-manager', {
          method: 'POST',
          body: {
            fullName: document.getElementById('signupFullName').value.trim(),
            primaryEmail: document.getElementById('signupPrimaryEmail').value.trim(),
            secondaryEmail: document.getElementById('signupSecondaryEmail').value.trim(),
            phoneNumber: document.getElementById('signupPhoneNumber').value.trim(),
            username: document.getElementById('signupUsername').value.trim() || undefined,
            password,
          },
        });
        redirectTo('/team.html');
      } catch (error) {
        setStatus(statusNode, error.message, 'error');
      }
    });

    managerLoginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await handleLogin(event.currentTarget, 'managerLoginStatus');
    });

    employeeLoginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await handleLogin(event.currentTarget, 'employeeLoginStatus');
    });
  }

  async function handleLogin(form, statusId) {
    const statusNode = document.getElementById(statusId);

    try {
      setStatus(statusNode, 'Signing you in...', 'info');
      const response = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: {
          identifier: form.querySelector('[name="identifier"]').value.trim(),
          password: form.querySelector('[name="password"]').value,
        },
      });
      redirectForSession(response);
    } catch (error) {
      setStatus(statusNode, error.message, 'error');
    }
  }

  async function initLoginPage() {
    const session = await getCurrentSession();
    if (session) {
      redirectForSession(session);
      return;
    }

    const form = document.getElementById('loginForm');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      await handleLogin(form, 'loginStatus');
    });
  }

  async function initCompleteSetupPage() {
    const session = await getCurrentSession();
    if (session && !session.user.requiresProfileCompletion) {
      redirectForSession(session);
      return;
    }

    const params = parseQuery();
    const userId = params.get('userId') || session?.user?.id;
    const form = document.getElementById('completeSetupForm');
    const statusNode = document.getElementById('completeSetupStatus');

    if (!userId) {
      setStatus(statusNode, 'Missing user ID. Ask your manager for the setup link.', 'error');
      return;
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const newPassword = document.getElementById('completeNewPassword').value;
      const confirmPassword = document.getElementById('completeConfirmPassword').value;

      if (newPassword !== confirmPassword) {
        setStatus(statusNode, 'Passwords do not match.', 'error');
        return;
      }

      try {
        setStatus(statusNode, 'Completing your account setup...', 'info');
        const response = await apiRequest(`/api/account/${userId}/complete-setup`, {
          method: 'POST',
          body: {
            temporaryPassword: document.getElementById('completeTemporaryPassword').value,
            username: document.getElementById('completeUsername').value.trim(),
            newPassword,
            phoneNumber: document.getElementById('completePhone').value.trim(),
            secondaryEmail: document.getElementById('completeSecondaryEmail').value.trim(),
          },
        });
        redirectForSession(response);
      } catch (error) {
        setStatus(statusNode, error.message, 'error');
      }
    });
  }

  async function initTeamPage() {
    const session = await requireSession();
    const membership = getPrimaryMembership(session);
    const teamCreateSection = document.getElementById('teamCreateSection');
    const teamDetailsSection = document.getElementById('teamDetailsSection');
    const noTeamSection = document.getElementById('noTeamSection');
    const createForm = document.getElementById('teamCreateForm');
    const inviteForm = document.getElementById('teamInviteForm');
    const createStatus = document.getElementById('teamCreateStatus');
    const inviteStatus = document.getElementById('teamInviteStatus');
    const inviteResults = document.getElementById('inviteResults');

    teamCreateSection.hidden = true;
    teamDetailsSection.hidden = true;
    noTeamSection.hidden = true;

    if (!membership) {
      if (isManager(session)) {
        teamCreateSection.hidden = false;
      } else {
        noTeamSection.hidden = false;
      }

      createForm?.addEventListener('submit', async (event) => {
        event.preventDefault();

        try {
          setStatus(createStatus, 'Creating team...', 'info');
          await apiRequest('/api/team/create', {
            method: 'POST',
            body: {
              name: document.getElementById('teamNameInput').value.trim(),
            },
          });
          redirectTo('/team.html');
        } catch (error) {
          setStatus(createStatus, error.message, 'error');
        }
      });

      return;
    }

    const teamId = membership.teamId;
    teamDetailsSection.hidden = false;
    document.getElementById('teamPageTitle').textContent = membership.teamName;

    const teamData = await apiRequest(`/api/team/${teamId}`);
    renderMembers(teamData.members);

    if (!isManager(session)) {
      document.getElementById('invitePanel').hidden = true;
      return;
    }

    inviteForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      try {
        setStatus(inviteStatus, 'Adding team member...', 'info');
        const response = await apiRequest(`/api/team/${teamId}/members`, {
          method: 'POST',
          body: {
            members: [
              {
                fullName: document.getElementById('inviteFullName').value.trim(),
                primaryEmail: document.getElementById('inviteEmail').value.trim(),
                employmentRole: document.getElementById('inviteRole').value.trim(),
              },
            ],
          },
        });

        setStatus(inviteStatus, 'Team member added.', 'success');
        renderMembers((await apiRequest(`/api/team/${teamId}`)).members);
        inviteResults.innerHTML = response.createdMembers
          .map(
            (member) => `
              <article class="credential-card">
                <h4>${escapeHtml(member.user.fullName)}</h4>
                <p><strong>Temporary username:</strong> ${escapeHtml(
                  member.temporaryCredentials.username
                )}</p>
                <p><strong>Temporary password:</strong> ${escapeHtml(
                  member.temporaryCredentials.password
                )}</p>
                <p><a href="/profileSetupManager.html?userId=${encodeURIComponent(
                  member.user.id
                )}">Open account setup page</a></p>
              </article>
            `
          )
          .join('');
        inviteForm.reset();
      } catch (error) {
        setStatus(inviteStatus, error.message, 'error');
      }
    });
  }

  function renderMembers(members) {
    const tbody = document.getElementById('teamMembersBody');
    tbody.innerHTML = members
      .map(
        (member) => `
          <tr>
            <td>${escapeHtml(member.fullName)}</td>
            <td>${escapeHtml(member.primaryEmail)}</td>
            <td>${escapeHtml(member.employmentRole || member.systemRole)}</td>
            <td>${member.isManager ? '<span class="pill">Manager</span>' : 'Team Member'}</td>
          </tr>
        `
      )
      .join('');
  }

  async function initAvailabilityPage() {
    const session = await requireSession();
    const userId = session.user.id;
    const statusNode = document.getElementById('availabilityStatus');
    const editor = document.getElementById('availabilityEditor');
    const response = await apiRequest(`/api/availability/${userId}`);
    renderAvailabilityEditor(editor, response.availability);

    document.getElementById('availabilityForm').addEventListener('submit', async (event) => {
      event.preventDefault();

      try {
        setStatus(statusNode, 'Saving availability...', 'info');
        
        await apiRequest(`/api/availability/${userId}`, {
          method: 'PUT',
          body: {
            availability: collectAvailability(editor),
          },
        });
        setStatus(statusNode, 'Availability saved.', 'success');
      } catch (error) {
        setStatus(statusNode, error.message, 'error');
      }
    });
  }

  async function initConstraintsPage() {
    const session = await requireSession({ managerOnly: true });
    const membership = getPrimaryMembership(session);
    const statusNode = document.getElementById('constraintsStatus');

    if (!membership) {
      setStatus(statusNode, 'Create a team first before configuring constraints.', 'error');
      return;
    }

    const teamId = membership.teamId;
    const data = await apiRequest(`/api/schedule/constraints/${teamId}`);

    document.getElementById('hoursWindowDays').value = String(data.hoursWindowDays || 7);
    document.getElementById('minHoursPerWindow').value = data.minHoursPerWindow ?? '';
    document.getElementById('maxHoursPerWindow').value = data.maxHoursPerWindow ?? '';
    document.getElementById('minStaffPerHour').value = data.minStaffPerHour ?? '';
    document.getElementById('maxStaffPerHour').value = data.maxStaffPerHour ?? '';
    document.getElementById('businessHoursGrid').innerHTML = createDayRowsHtml(
      'business',
      data.businessHours || []
    );
    renderRoleRequirementRows(
      document.getElementById('roleRequirementsList'),
      data.roleRequirements || []
    );

    document.getElementById('addRoleRequirementButton').addEventListener('click', () => {
      const container = document.getElementById('roleRequirementsList');
      const requirements = collectRoleRequirements(container);
      requirements.push({
        roleName: '',
        dayOfWeek: '',
        startTime: '',
        endTime: '',
        minEmployees: 1,
      });
      renderRoleRequirementRows(container, requirements);
    });

    document.getElementById('constraintsForm').addEventListener('submit', async (event) => {
      event.preventDefault();

      try {
        setStatus(statusNode, 'Saving constraints...', 'info');
        await apiRequest(`/api/schedule/constraints/${teamId}`, {
          method: 'PUT',
          body: {
            hoursWindowDays: Number(document.getElementById('hoursWindowDays').value || 7),
            minHoursPerWindow: nullableNumber(document.getElementById('minHoursPerWindow').value),
            maxHoursPerWindow: nullableNumber(document.getElementById('maxHoursPerWindow').value),
            minStaffPerHour: nullableNumber(document.getElementById('minStaffPerHour').value),
            maxStaffPerHour: nullableNumber(document.getElementById('maxStaffPerHour').value),
            businessHours: collectBusinessHours(document.getElementById('businessHoursGrid')),
            roleRequirements: collectRoleRequirements(
              document.getElementById('roleRequirementsList')
            ).map((entry) => ({
              ...entry,
              dayOfWeek: entry.dayOfWeek === '' ? null : Number(entry.dayOfWeek),
              startTime: entry.startTime || null,
              endTime: entry.endTime || null,
            })),
          },
        });
        setStatus(statusNode, 'Constraints saved.', 'success');
      } catch (error) {
        setStatus(statusNode, error.message, 'error');
      }
    });
  }

  function nullableNumber(value) {
    return value === '' ? null : Number(value);
  }

  async function initManagerSchedulePage() {
    const session = await requireSession({ managerOnly: true });
    const membership = getPrimaryMembership(session);
    const scheduleStatus = document.getElementById('scheduleStatus');

    if (!membership) {
      setStatus(scheduleStatus, 'Create a team first before building a schedule.', 'error');
      document.getElementById('managerSchedulePanel').hidden = true;
      return;
    }

    const teamId = membership.teamId;
    const team = await apiRequest(`/api/team/${teamId}`);
    const memberSelect = document.getElementById('shiftUserId');
    memberSelect.innerHTML = team.members
      .map(
        (member) => `
          <option value="${member.id}">${escapeHtml(member.fullName)} (${escapeHtml(
            member.employmentRole || member.systemRole
          )})</option>
        `
      )
      .join('');

    let currentWeekStart = parseQuery().get('weekStartDate') || getWeekStart(today());
    let currentSchedule = null;

    async function loadSchedule() {
      currentSchedule = await apiRequest(
        `/api/schedule/team/${teamId}?weekStartDate=${encodeURIComponent(currentWeekStart)}`
      );

      document.getElementById('scheduleWeekLabel').textContent = formatWeekLabel(currentWeekStart);
      renderShiftRows(
        document.getElementById('managerScheduleBody'),
        currentSchedule.shifts,
        true
      );
      renderWeekCards(
        document.getElementById('managerWeekCards'),
        currentSchedule.shifts,
        currentSchedule.totals,
        currentWeekStart
      );
      document.getElementById('finalizationState').textContent = currentSchedule.isFinalized
        ? `Finalized on ${currentSchedule.finalizedAt}`
        : 'Not finalized yet';
      bindShiftActions();
    }

    function bindShiftActions() {
      document.querySelectorAll('[data-edit-shift]').forEach((button) => {
        button.addEventListener('click', () => {
          const shift = currentSchedule.shifts.find(
            (entry) => Number(entry.id) === Number(button.dataset.editShift)
          );
          if (!shift) {
            return;
          }

          document.getElementById('shiftFormTitle').textContent = 'Edit Shift';
          document.getElementById('shiftId').value = shift.id;
          document.getElementById('shiftUserId').value = shift.userId;
          document.getElementById('shiftDate').value = shift.shiftDate;
          document.getElementById('shiftStartTime').value = shift.startTime;
          document.getElementById('shiftEndTime').value = shift.endTime;
          document.getElementById('shiftRole').value = shift.employmentRole;
          document.getElementById('shiftRepeatWeekly').checked = false;
          document.getElementById('shiftRepeatUntil').value = '';
          document.getElementById('shiftRepeatUntil').disabled = true;
        });
      });

      document.querySelectorAll('[data-delete-shift]').forEach((button) => {
        button.addEventListener('click', async () => {
          if (!window.confirm('Delete this shift?')) {
            return;
          }

          try {
            setStatus(scheduleStatus, 'Deleting shift...', 'info');
            const result = await runWithOverride(
              (overridePassword) =>
                apiRequest(`/api/schedule/shifts/${button.dataset.deleteShift}`, {
                  method: 'DELETE',
                  body: overridePassword ? { overridePassword } : {},
                }),
              document.getElementById('shiftIssueList')
            );

            if (!result) {
              setStatus(scheduleStatus, 'Shift deletion cancelled.', 'info');
              return;
            }

            await loadSchedule();
            setStatus(scheduleStatus, 'Shift deleted.', 'success');
          } catch (error) {
            setStatus(scheduleStatus, error.message, 'error');
          }
        });
      });
    }

    document.getElementById('previousWeekButton').addEventListener('click', async () => {
      currentWeekStart = addDays(currentWeekStart, -7);
      await loadSchedule();
    });

    document.getElementById('nextWeekButton').addEventListener('click', async () => {
      currentWeekStart = addDays(currentWeekStart, 7);
      await loadSchedule();
    });

    document.getElementById('shiftRepeatWeekly').addEventListener('change', (event) => {
      document.getElementById('shiftRepeatUntil').disabled = !event.target.checked;
    });

    document.getElementById('shiftForm').addEventListener('submit', async (event) => {
      event.preventDefault();

      const shiftId = document.getElementById('shiftId').value;
      const payload = {
        teamId,
        userId: Number(document.getElementById('shiftUserId').value),
        shiftDate: document.getElementById('shiftDate').value,
        startTime: document.getElementById('shiftStartTime').value,
        endTime: document.getElementById('shiftEndTime').value,
        employmentRole: document.getElementById('shiftRole').value.trim(),
      };

      if (!shiftId && document.getElementById('shiftRepeatWeekly').checked) {
        payload.repeatWeekly = true;
        payload.repeatUntil = document.getElementById('shiftRepeatUntil').value;
      }

      try {
        setStatus(scheduleStatus, shiftId ? 'Updating shift...' : 'Creating shift...', 'info');
        const result = await runWithOverride(
          (overridePassword) =>
            apiRequest(
              shiftId ? `/api/schedule/shifts/${shiftId}` : '/api/schedule/shifts',
              {
                method: shiftId ? 'PUT' : 'POST',
                body: overridePassword ? { ...payload, overridePassword } : payload,
              }
            ),
          document.getElementById('shiftIssueList')
        );

        if (!result) {
          setStatus(scheduleStatus, 'Shift save cancelled.', 'info');
          return;
        }

        resetShiftForm();
        await loadSchedule();
        setStatus(scheduleStatus, shiftId ? 'Shift updated.' : 'Shift created.', 'success');
      } catch (error) {
        setStatus(scheduleStatus, error.message, 'error');
      }
    });

    document.getElementById('shiftFormReset').addEventListener('click', () => {
      resetShiftForm();
    });

    document.getElementById('finalizeScheduleButton').addEventListener('click', async () => {
      /*const managerPassword = window.prompt(
        `Enter your manager password to finalize the week of ${formatWeekLabel(currentWeekStart)}.`
      );

      if (!managerPassword) {
        return;
      }*/

      const payload = {
        teamId,
        weekStartDate: currentWeekStart,
        //managerPassword
      };

      try {
        setStatus(scheduleStatus, 'Finalizing schedule...', 'info');
        const result = await runWithOverride(
          (overridePassword) =>
              apiRequest('/api/schedule/finalize', {
            method: 'POST',
            body: overridePassword ? { ...payload, overridePassword } : payload,
          }
          ),
          document.getElementById('shiftIssueList')
        );

        if (!result) {
          setStatus(scheduleStatus, 'Finalize have been cancelled.', 'info');
          return;
        }
        /*await apiRequest('/api/schedule/finalize', {
          method: 'POST',
          body: {
            teamId,
            weekStartDate: currentWeekStart,
            managerPassword,
          },
        });*/
        await loadSchedule();
        setStatus(scheduleStatus, 'Schedule finalized.', 'success');
      } catch (error) {
        setStatus(scheduleStatus, error.message, 'error');
      }
    });

    function resetShiftForm() {
      document.getElementById('shiftFormTitle').textContent = 'Add Shift';
      document.getElementById('shiftForm').reset();
      document.getElementById('shiftId').value = '';
      document.getElementById('shiftDate').value = currentWeekStart;
      document.getElementById('shiftRepeatUntil').disabled = true;
      document.getElementById('shiftIssueList').hidden = true;
      document.getElementById('shiftIssueList').innerHTML = '';
    }

    resetShiftForm();
    await loadSchedule();
  }

  async function initEmployeeSchedulePage() {
    const session = await requireSession();
    if (isManager(session)) {
      redirectTo('/mainSchedule.html');
      return;
    }

    const membership = getPrimaryMembership(session);
    const statusNode = document.getElementById('employeeScheduleStatus');

    if (!membership) {
      setStatus(statusNode, 'You do not belong to a team yet.', 'error');
      return;
    }

    let currentWeekStart = parseQuery().get('weekStartDate') || getWeekStart(today());

    async function loadSchedule() {
      const data = await apiRequest(
        `/api/schedule/user/${session.user.id}?teamId=${membership.teamId}&weekStartDate=${encodeURIComponent(
          currentWeekStart
        )}`
      );
      document.getElementById('employeeWeekLabel').textContent = formatWeekLabel(currentWeekStart);
      renderShiftRows(document.getElementById('employeeScheduleBody'), data.shifts, false);
      renderWeekCards(
        document.getElementById('employeeWeekCards'),
        data.shifts,
        null,
        currentWeekStart,
        session.user.id
      );
      document.getElementById('employeeWeeklyHours').textContent = `${data.totalHours} hours`;
    }

    document.getElementById('employeePreviousWeekButton').addEventListener('click', async () => {
      currentWeekStart = addDays(currentWeekStart, -7);
      await loadSchedule();
    });

    document.getElementById('employeeNextWeekButton').addEventListener('click', async () => {
      currentWeekStart = addDays(currentWeekStart, 7);
      await loadSchedule();
    });

    await loadSchedule();
  }

  async function initMainRedirectPage() {
    const session = await getCurrentSession();
    if (session) {
      redirectForSession(session);
      return;
    }
    redirectTo('/indexSignUp.html');
  }
})();
