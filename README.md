SCHEDULE_BUILDER

DESCRIPTION: a web-based system that allows creating a flexible weekly schedule for small teams, adhering to business rules and personal availability.

USERS: 
    Manager - manages a team and the schedule; is able to create/edit/delete new shifts and set business rules (scheduling constraints, such as business hours, weekly hours limit per employee, and the number of employees scheduled at the same time).
    Team Member - views personal schedule, manages personal availability.

FEATURES: 
  1. Team Management
      - Create teams.
      - Invite employees (auto-generates username and password) // credentials are designed to be emailed to a Team Member, but that functionality is not yet finished.
      - Remove team members (their past shifts are preserver for shift_audit_log, the shifts from the day od deletion and onwards are deleted).
  2. Schedule Management
      - Create, edit, and delete shifts.
      - Possibility to make a shift recurring, with end date.
      - Week-by-week schedule viewing.
      - Schedule finalization with override capability.
  3. Availability & Scheduling Constraints - pop-up warning if the shift created violates availability or scheduling constraints; the manager either must make changes or override with their passwords
      - Employee availability by day of week with time ranges.
      - Business hours configuration.
      - Role-based staffing requirements.
      - Min/max hours per time window (verified when the week's schedule is finalized).
      - Min/max staff per hour.
  4. Notifications (desired, but not implemented yet)
     - Automatic notifications for schedule finalization.
     - Team invitation notifications.
--------------------------------------------------------------
**Backend summary for frontend integration**
What’s already built:
    - Manager registration
    - Login/logout with session cookies
    - “Current session” endpoint to restore the logged-in user
    -  Password reset by primary email
    -  Team creation
    -  Adding team members by work email + full name + employment role
    -  Temporary credentials for invited team members
    -  Team-member first-time account setup
    -  Profile updates for username/password/contact info
    -  Weekly availability create/update
    -  Team schedule view
    -  Personal schedule view
    -  Scheduling constraints:
    -  business hours
    -  min/max hours per 7-day or 14-day window
    -  min/max staff at a time
    -  required roles at certain times
    -  Shift create/edit/delete
    -  Weekly recurring shifts
    -  Constraint violation detection
    -   Manager password override when forcing a violating shift change
    -  Schedule finalization for a week
    -  Notifications stored in the backend for invites, password reset, and finalized schedule changes

**Important auth note**
  Frontend must send requests with cookies included.
  In fetch, use credentials: 'include'.
  
Main auth endpoints:
    POST /api/auth/register-manager
    POST /api/auth/login
    GET /api/auth/session
    POST /api/auth/logout
    POST /api/auth/request-password-reset
    POST /api/auth/reset-password
Account endpoints:
    POST /api/account/:userId/complete-setup
    GET /api/account/:userId
    PATCH /api/account/:userId/profile
    GET /api/account/:userId/notifications
Team endpoints:
    POST /api/team/create
    GET /api/team/:teamId
    GET /api/team/:teamId/members
    POST /api/team/:teamId/members
Availability endpoints:
    GET /api/availability/:userId
    PUT /api/availability/:userId
    Schedule endpoints:
    GET /api/schedule/constraints/:teamId
    PUT /api/schedule/constraints/:teamId
    POST /api/schedule/shifts
    PUT /api/schedule/shifts/:shiftId
    DELETE /api/schedule/shifts/:shiftId
    GET /api/schedule/team/:teamId?weekStartDate=YYYY-MM-DD
    GET /api/schedule/user/:userId?teamId=...&weekStartDate=YYYY-MM-DD
    POST /api/schedule/finalize

**What the frontend needs to do:**
Build auth flow:
    -manager sign-up
    -login
    -logout
    -session restore on app load with GET /api/auth/session
Build role-based UI:
    -manager dashboard
    -team-member dashboard
Build first-time team-member setup screen using temporary credentials
Build profile/settings page
Build weekly availability editor
Build team schedule calendar/table view
Build “my schedule” view
Build manager pages for:
    -creating a team
    -inviting employees
    -editing constraints

-----------------------------------------------------------------------------------
TECHNICAL REQUIREMENTS
Frontend: HTML5/CSS, JavaScript
Backend: 
- Runtime: Node.js
- Framework: Express.js 5.x
- Database: SQLite3
- Authentication: Session-based with password hashing

INSTALLATION: 
prerequisites
- Node.js 
- npm 

Initialize the database: SQLite extension; the database will be automatically created and initialized when you first start the server.

Server: http://localhost:3000

TESTING
**Suggested Flow** - Manager Account
1. Create a manager account; finish account setup.
2. Create a team; add team members.
   - currently, when a new team member is added, their login credentials, including a temporary password, are displayed at the bottom of the team page.
   - save login credentials in a text doc to access a team member's account.

Optional - as a Team Member
- sign in using temporary password, finish account setup.
- set availability ( **IMPORTANT**: default availability is open - employee can be scheduled anytime;
                                    checkout the checkbox on the left to set the availability window for a given weekday - e.g., Monday 14:00-20:00;
                                    to mark a day as unavailable, check the box and enter 00:00-00:00).
3. Set Scheduling constraints:
- business hours for each weekday (e.g, 8:00 - 17:00) - now the system will give a warning if trying to create a shift outside of those hours
- max/min working hours per employee (e.g., employees cannot work more than 25 hours per week)
- staffing rules if a specific role is needed on a shift (a Manager must work on Fridays)

4. Manage Team Schedule
- add shifts for employees for a given week (make a shift recurring if needed - make sure that the end day is exactly /7 days apart)
- finalize week schedule when completed - if any rules are violated, make changes or override
   
Other options: 
-Edit a Shift
-Delete a Shift
-Delete Employee (employee is removed from the team; their past shifts are preserved on the schedule; current day and future shifts are deleted)

TROUBLESHOOTING 
known issues and limitations
1. Right Availability input - ensure to check the checkbox when making changes to a weekday, otherwise the changes will not be saved;
2. Recurring Shift - if checking a shift as reccuring during creation, ensure end date is a week/two weeks/etc away.
3. Edit shift - the button is functional. After pressing changes, scroll down - Edit Shift form has replaced Add Shift form


FUTURE ENHANCEMENTS:
Email notifications for schedule changes
Email with invintation and login credentials when a team member is added
Transfering an employee between teams (with same corporate email)
2FA implementation
Manager able to view team members' availability and move between their personal schedules
