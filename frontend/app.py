"""
Smart Tournament Planner — Sprint 3 Frontend
"""

import streamlit as st
import requests
import pandas as pd
import os
from datetime import date, time, datetime

# ─────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────
API_BASE = os.getenv("API_BASE_URL", "http://127.0.0.1:5000/api").rstrip("/")

st.set_page_config(
    page_title="Smart Tournament Planner",
    page_icon="⚽",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ─────────────────────────────────────────────
# Custom CSS
# ─────────────────────────────────────────────
st.markdown("""
<style>
    /* Sidebar branding */
    [data-testid="stSidebar"] { background-color: #0f172a; }
    [data-testid="stSidebar"] * { color: #e2e8f0 !important; }
    [data-testid="stSidebar"] .stRadio label { color: #cbd5e1 !important; }

    /* Cards */
    .card {
        background: #1e293b;
        border-radius: 12px;
        padding: 1.2rem 1.4rem;
        margin-bottom: 0.8rem;
        border: 1px solid #334155;
    }
    .card h4 { color: #38bdf8; margin: 0 0 0.4rem 0; }

    /* Badges */
    .badge {
        display: inline-block;
        padding: 2px 10px;
        border-radius: 20px;
        font-size: 0.75rem;
        font-weight: 600;
        margin-left: 6px;
    }
    .badge-blue  { background:#1e40af; color:#bfdbfe; }
    .badge-green { background:#166534; color:#bbf7d0; }
    .badge-red   { background:#991b1b; color:#fecaca; }
    .badge-gray  { background:#374151; color:#d1d5db; }

    /* Round header */
    .round-header {
        background: linear-gradient(90deg, #0ea5e9, #6366f1);
        color: white !important;
        padding: 6px 16px;
        border-radius: 8px;
        font-weight: 700;
        margin: 12px 0 6px 0;
        display: inline-block;
    }

    /* Section divider */
    .section-title {
        font-size: 1.1rem;
        font-weight: 700;
        color: #38bdf8;
        border-bottom: 2px solid #334155;
        padding-bottom: 4px;
        margin: 1.2rem 0 0.8rem 0;
    }

    /* Match vs text */
    .vs-text { color: #f97316; font-weight: 800; }

    /* Bracket node */
    .bracket-match {
        font-family: monospace;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 6px;
        padding: 4px 10px;
        margin: 2px 0;
        font-size: 0.85rem;
    }
</style>
""", unsafe_allow_html=True)

# ─────────────────────────────────────────────
# Session State Init
# ─────────────────────────────────────────────
for key, default in {
    "token": None,
    "user": None,
    "auth_restore_attempted_token": None,
    "auth_restore_error": None,
    "current_page": "🏆 Tournaments",
}.items():
    if key not in st.session_state:
        st.session_state[key] = default

# ─────────────────────────────────────────────
# API Helpers
# ─────────────────────────────────────────────
def auth_headers():
    token = st.session_state.get("token")
    if not token:
        return {}
    return {"Authorization": f"Bearer {token}"}

def api_get(path, params=None, timeout=10):
    try:
        r = requests.get(f"{API_BASE}{path}", headers=auth_headers(), params=params, timeout=timeout)
        return r.json(), r.status_code
    except requests.exceptions.ConnectionError:
        return {"error": "Cannot connect to backend (is it running on port 5000?)"}, 503
    except requests.exceptions.Timeout:
        return {"error": "Backend request timed out. Please try again."}, 504
    except Exception as e:
        return {"error": str(e)}, 500

def api_post(path, data=None, timeout=15):
    try:
        r = requests.post(f"{API_BASE}{path}", json=data, headers=auth_headers(), timeout=timeout)
        return r.json(), r.status_code
    except requests.exceptions.ConnectionError:
        return {"error": "Cannot connect to backend (is it running on port 5000?)"}, 503
    except requests.exceptions.Timeout:
        return {"error": "Backend request timed out. Please try again."}, 504
    except Exception as e:
        return {"error": str(e)}, 500

def api_put(path, data=None):
    try:
        r = requests.put(f"{API_BASE}{path}", json=data, headers=auth_headers(), timeout=10)
        return r.json(), r.status_code
    except requests.exceptions.ConnectionError:
        return {"error": "Cannot connect to backend (is it running on port 5000?)"}, 503
    except requests.exceptions.Timeout:
        return {"error": "Backend request timed out. Please try again."}, 504
    except Exception as e:
        return {"error": str(e)}, 500

def api_delete(path):
    try:
        r = requests.delete(f"{API_BASE}{path}", headers=auth_headers(), timeout=10)
        return r.json(), r.status_code
    except requests.exceptions.ConnectionError:
        return {"error": "Cannot connect to backend (is it running on port 5000?)"}, 503
    except requests.exceptions.Timeout:
        return {"error": "Backend request timed out. Please try again."}, 504
    except Exception as e:
        return {"error": str(e)}, 500

if "clear_auth_cookie" not in st.session_state:
    st.session_state.clear_auth_cookie = False

# A browser cookie restores the signed-in Streamlit session after a page reload.
_AUTH_COOKIE = st.components.v2.component(
    "smart_tournament_auth_cookie",
    html="<span aria-hidden='true'></span>",
    js="""
export default function (component) {
  const { data, setStateValue } = component
  const name = "smart_tournament_token"
  const entry = document.cookie.split("; ").find((part) => part.startsWith(name + "="))
  const savedToken = entry ? decodeURIComponent(entry.slice(name.length + 1)) : ""
  const secure = window.location.protocol === "https:" ? "; Secure" : ""

  if (data?.clear) {
    if (savedToken) document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Strict${secure}`
    setStateValue("token", "")
  } else if (data?.token) {
    if (savedToken !== data.token) {
      document.cookie = `${name}=${encodeURIComponent(data.token)}; Max-Age=86400; Path=/; SameSite=Strict${secure}`
    }
  } else if (savedToken) {
    setStateValue("token", savedToken)
  }
}
""",
)
_auth_cookie_state = _AUTH_COOKIE(
    key="auth_cookie_state",
    data={"token": st.session_state.token, "clear": st.session_state.clear_auth_cookie},
    on_token_change=lambda: None,
)
if st.session_state.clear_auth_cookie:
    # Keep this flag set until a successful login. This prevents a rerun from
    # restoring the just-logged-out token before the browser clears its cookie.
    pass
elif not st.session_state.token and getattr(_auth_cookie_state, "token", None):
    st.session_state.token = _auth_cookie_state.token

if (
    st.session_state.token
    and not st.session_state.user
    and st.session_state.auth_restore_attempted_token != st.session_state.token
):
    st.session_state.auth_restore_attempted_token = st.session_state.token
    restored_user, restored_code = api_get("/users/me")
    if restored_code == 200 and restored_user.get("user"):
        st.session_state.user = restored_user["user"]
        st.session_state.auth_restore_error = None
    elif restored_code in (503, 504):
        st.session_state.auth_restore_error = restored_user.get("error", "Backend is temporarily unavailable.")
    else:
        st.session_state.token = None
        st.session_state.user = None
        st.session_state.clear_auth_cookie = True
        st.session_state.auth_restore_attempted_token = None
        st.rerun()

def show_api_error(resp, code):
    msg = resp.get("error") or resp.get("message") or str(resp)
    st.error(f"❌ Error {code}: {msg}")

# ─────────────────────────────────────────────
# Fetch Helpers
# ─────────────────────────────────────────────
def fetch_tournaments():
    data, code = api_get("/tournaments")
    if code == 200:
        return data.get("tournaments", [])
    return []

def fetch_teams(tournament_id):
    data, code = api_get("/teams", params={"tournament_id": tournament_id})
    if code == 200:
        return data.get("teams", [])
    return []

def fetch_players(team_id):
    data, code = api_get("/players", params={"team_id": team_id})
    if code == 200:
        return data.get("players", [])
    return []

def fetch_venues():
    data, code = api_get("/venues")
    if code == 200:
        return data.get("venues", [])
    return []

def fetch_venue_availability(venue_id):
    data, code = api_get("/venue-availability", params={"venue_id": venue_id})
    if code == 200:
        return data.get("availability", [])
    return []

def fetch_fixtures(tournament_id):
    data, code = api_get("/fixtures", params={"tournament_id": tournament_id}, timeout=60)
    if code == 200:
        return data.get("fixtures", data.get("data", []))
    return []

def fetch_tournament_plan(tournament_id):
    data, code = api_get("/fixtures/plan", params={"tournament_id": tournament_id})
    if code == 200:
        return data, code
    return data, code

def fetch_conflicts(tournament_id):
    data, code = api_get("/fixtures/conflicts", params={"tournament_id": tournament_id})
    if code == 200:
        return data.get("conflicts", data.get("data", {}).get("conflicts", []))
    return []

# ─────────────────────────────────────────────
# Role Utilities
# ─────────────────────────────────────────────
def role():
    return st.session_state.user.get("role", "") if st.session_state.user else ""

def is_organizer():
    return role() in ("ORGANIZER", "ADMIN")

def is_venue_coord():
    return role() in ("VENUE_COORDINATOR", "ORGANIZER", "ADMIN")

def is_team_captain():
    return role() in ("TEAM_CAPTAIN_PLAYER", "ORGANIZER", "ADMIN")

# ─────────────────────────────────────────────
# STATUS BADGE
# ─────────────────────────────────────────────
def status_badge(status):
    cls = {"SCHEDULED": "badge-blue", "COMPLETED": "badge-green", "CANCELLED": "badge-red"}.get(status, "badge-gray")
    return f'<span class="badge {cls}">{status}</span>'

# ─────────────────────────────────────────────
# PAGE 1 — AUTH
# ─────────────────────────────────────────────
def show_auth_page():
    col1, col2, col3 = st.columns([1, 2, 1])
    with col2:
        st.markdown("""
        <div style='text-align:center; padding: 2rem 0 1rem 0;'>
            <h1 style='font-size:2.5rem;'>⚽ Smart Tournament Planner</h1>
        </div>
        """, unsafe_allow_html=True)

        tab_login, tab_signup = st.tabs(["🔐 Login", "📝 Sign Up"])

        with tab_login:
            st.markdown("#### Welcome back!")
            with st.form("login_form"):
                email = st.text_input("📧 Email", placeholder="you@example.com")
                password = st.text_input("🔒 Password", type="password", placeholder="••••••••")
                submitted = st.form_submit_button("Login →", use_container_width=True, type="primary")

            if submitted:
                if not email or not password:
                    st.error("Please fill in all fields.")
                else:
                    with st.spinner("Logging in…"):
                        try:
                            r = requests.post(
                                f"{API_BASE}/users/login",
                                json={"email": email, "password": password},
                                timeout=10,
                            )
                            data = r.json()
                        except requests.exceptions.ConnectionError:
                            st.error("❌ Cannot connect to backend. Is the server running on port 5000?")
                            return
                        except Exception as e:
                            st.error(f"❌ {e}")
                            return

                    if r.status_code == 200:
                        st.session_state.token = data.get("token")
                        st.session_state.user = data.get("user")
                        st.session_state.clear_auth_cookie = False
                        st.session_state.auth_restore_attempted_token = None
                        st.session_state.auth_restore_error = None
                        st.session_state.current_page = "🏆 Tournaments"
                        st.success("✅ Logged in successfully!")
                        st.rerun()
                    else:
                        st.error(f"❌ {data.get('message', 'Login failed')}")

        with tab_signup:
            st.markdown("#### Create an account")
            role_choice = st.selectbox(
                "🏷️ Role",
                ["ORGANIZER", "VENUE_COORDINATOR", "PLAYER"],
                help="Choose your role in the platform",
                key="signup_role",
            )
            with st.form("signup_form"):
                name = st.text_input("👤 Full Name", placeholder="John Doe")
                s_email = st.text_input("📧 Email", placeholder="you@example.com", key="su_email")
                s_password = st.text_input("🔒 Password", type="password", placeholder="Min 6 characters", key="su_pass")
                submitted_su = st.form_submit_button("Create Account →", use_container_width=True, type="primary")

            if submitted_su:
                if not name or not s_email or not s_password:
                    st.error("Please fill in all required fields.")
                else:
                    with st.spinner("Creating account…"):
                        try:
                            r = requests.post(
                                f"{API_BASE}/users/register",
                                json={
                                    "name": name, "email": s_email, "password": s_password, "role": role_choice,
                                },
                                timeout=10,
                            )
                            data = r.json()
                        except requests.exceptions.ConnectionError:
                            st.error("❌ Cannot connect to backend.")
                            return
                        except Exception as e:
                            st.error(f"❌ {e}")
                            return

                    if r.status_code in (200, 201):
                        st.success("Account created and saved. You can log in later with the same email and password.")
                        if role_choice == "PLAYER":
                            st.info("After login, open Team Management to select a tournament and view every team and its player roster.")
                    elif r.status_code == 409 and "already registered" in data.get("message", "").lower():
                        st.info("This account already exists. Use the Login tab with the same email and password.")
                    else:
                        st.error(f"❌ {data.get('message', 'Registration failed')}")

# ─────────────────────────────────────────────
# PAGE 2 — TOURNAMENTS
# ─────────────────────────────────────────────
def show_tournaments_page():
    st.title("🏆 Tournament Management")
    if not is_organizer():
        st.warning("⚠️ Only Organizers can manage tournaments.")
        return

    # ── List Tournaments ──────────────────────
    st.markdown('<div class="section-title">📋 My Tournaments</div>', unsafe_allow_html=True)
    with st.spinner("Loading tournaments…"):
        tournaments = fetch_tournaments()

    if not tournaments:
        st.info("No tournaments yet. Create one below!")
    else:
        df = pd.DataFrame(tournaments)[["id", "name", "sport", "format", "start_date", "end_date"]]
        df.columns = ["ID", "Name", "Sport", "Format", "Start Date", "End Date"]
        st.dataframe(df, use_container_width=True, hide_index=True)

        # Expandable edit/delete per tournament
        st.markdown('<div class="section-title">✏️ Edit / Delete Tournament</div>', unsafe_allow_html=True)
        for t in tournaments:
            with st.expander(f"🏆 {t['name']} ({t['sport']} · {t['format']})"):
                col_e, col_d = st.columns([3, 1])
                with col_e:
                    with st.form(f"edit_t_{t['id']}"):
                        new_name = st.text_input("Name", value=t.get("name", ""))
                        new_sport = st.selectbox("Sport", ["CRICKET", "FOOTBALL", "FUTSAL"], index=["CRICKET", "FOOTBALL", "FUTSAL"].index(t.get("sport", "FOOTBALL")))
                        new_format = st.selectbox("Format", ["KNOCKOUT", "LEAGUE", "GROUP_STAGE"], index=["KNOCKOUT", "LEAGUE", "GROUP_STAGE"].index(t.get("format", "KNOCKOUT")))
                        new_start = st.date_input("Start Date", value=pd.to_datetime(t.get("start_date")).date() if t.get("start_date") else date.today())
                        new_end = st.date_input("End Date", value=pd.to_datetime(t.get("end_date")).date() if t.get("end_date") else date.today())
                        if st.form_submit_button("💾 Save Changes", type="primary"):
                            with st.spinner("Updating…"):
                                resp, code = api_put(f"/tournaments/{t['id']}", {
                                    "name": new_name,
                                    "sport": new_sport,
                                    "format": new_format,
                                    "start_date": str(new_start),
                                    "end_date": str(new_end),
                                })
                            if code in (200, 201):
                                st.success("✅ Tournament updated!")
                                st.rerun()
                            else:
                                show_api_error(resp, code)
                with col_d:
                    st.write("")
                    st.write("")
                    if st.button(f"🗑️ Delete", key=f"del_t_{t['id']}", use_container_width=True):
                        with st.spinner("Deleting…"):
                            resp, code = api_delete(f"/tournaments/{t['id']}")
                        if code in (200, 204):
                            st.success("✅ Tournament deleted!")
                            st.rerun()
                        else:
                            show_api_error(resp, code)

    # ── Create Tournament ─────────────────────
    st.markdown('<div class="section-title">➕ Create New Tournament</div>', unsafe_allow_html=True)
    with st.form("create_tournament"):
        c1, c2 = st.columns(2)
        with c1:
            t_name = st.text_input("Tournament Name *", placeholder="e.g. Inter-Campus Cricket Cup")
            t_sport = st.selectbox("Sport *", ["CRICKET", "FOOTBALL", "FUTSAL"])
            t_format = st.selectbox("Format *", ["KNOCKOUT", "LEAGUE", "GROUP_STAGE"])
        with c2:
            t_start = st.date_input("Start Date *", value=date.today())
            t_end = st.date_input("End Date *", value=date.today())
        if st.form_submit_button("🚀 Create Tournament", type="primary", use_container_width=True):
            if not t_name:
                st.error("Tournament name is required.")
            elif t_end < t_start:
                st.error("End date must be on or after start date.")
            else:
                with st.spinner("Creating tournament…"):
                    resp, code = api_post("/tournaments", {
                        "name": t_name,
                        "sport": t_sport,
                        "format": t_format,
                        "start_date": str(t_start),
                        "end_date": str(t_end),
                    })
                if code in (200, 201):
                    st.success(f"✅ Tournament '{t_name}' created!")
                    st.rerun()
                else:
                    show_api_error(resp, code)

    # ── Scheduling Config ─────────────────────
    st.markdown('<div class="section-title">⚙️ Tournament Scheduling Configuration</div>', unsafe_allow_html=True)
    tournaments_refresh = fetch_tournaments()
    if not tournaments_refresh:
        st.info("No tournaments to configure.")
        return

    t_names = {f"{t['name']} (#{t['id']})": t for t in tournaments_refresh}
    sel_name = st.selectbox("Select Tournament to Configure", list(t_names.keys()), key="sched_sel")
    sel_t = t_names[sel_name]
    tournament_id = sel_t["id"]
    st.caption("The tournament date range below is used to find matching venue availability on the Venue Selection page.")

    with st.form(f"sched_config_{tournament_id}"):
        date_col1, date_col2 = st.columns(2)
        with date_col1:
            sched_start_date = st.date_input(
                "Tournament Start Date",
                value=pd.to_datetime(sel_t.get("start_date")).date() if sel_t.get("start_date") else date.today(),
                key=f"sched_date_start_{tournament_id}",
            )
        with date_col2:
            sched_end_date = st.date_input(
                "Tournament End Date",
                value=pd.to_datetime(sel_t.get("end_date")).date() if sel_t.get("end_date") else date.today(),
                key=f"sched_date_end_{tournament_id}",
            )
        c1, c2, c3, c4 = st.columns(4)
        with c1:
            ms_time = st.time_input("Match Start Time", value=time.fromisoformat(str(sel_t.get("match_start_time") or "09:00:00")), key=f"sched_start_{tournament_id}")
        with c2:
            me_time = st.time_input("Match End Time", value=time.fromisoformat(str(sel_t.get("match_end_time") or "18:00:00")), key=f"sched_end_{tournament_id}")
        with c3:
            duration = st.number_input("Match Duration (min)", min_value=10, max_value=300, value=int(sel_t.get("match_duration_minutes") or 90), key=f"sched_duration_{tournament_id}")
        with c4:
            rest = st.number_input("Min Rest (min)", min_value=0, max_value=240, value=int(sel_t.get("minimum_rest_minutes") if sel_t.get("minimum_rest_minutes") is not None else 30), key=f"sched_rest_{tournament_id}")
        if st.form_submit_button("💾 Save Schedule Config", type="primary", use_container_width=True):
            with st.spinner("Saving…"):
                resp, code = api_put(f"/tournaments/{sel_t['id']}/schedule", {
                    "match_start_time": str(ms_time),
                    "match_end_time": str(me_time),
                    "match_duration_minutes": duration,
                    "minimum_rest_minutes": rest,
                    "start_date": str(sched_start_date),
                    "end_date": str(sched_end_date),
                })
            if code in (200, 201):
                st.success("✅ Schedule configuration saved!")
            else:
                show_api_error(resp, code)

# ─────────────────────────────────────────────
# PAGE 3 — TEAM MANAGEMENT
# ─────────────────────────────────────────────
def show_teams_page():
    st.title("👥 Team Management")
    if not is_team_captain() and role() != "PLAYER":
        st.warning("⚠️ Access denied.")
        return

    if role() == "PLAYER":
        with st.spinner("Loading organizer teams..."):
            teams_data, teams_code = api_get("/teams/available")
        if teams_code != 200:
            show_api_error(teams_data, teams_code)
            return
        available_teams = teams_data.get("teams", [])
        if not available_teams:
            st.info("No organizer teams are available yet.")
            return
        team_map = {
            f"{team['team_name']} - {team['tournament_name']} ({team['sport']}) #{team['id']}": team
            for team in available_teams
        }
        team_ids_key = "_".join(str(team["id"]) for team in available_teams)
        selected_label = st.selectbox(
            "Select Team", list(team_map), key=f"player_team_select_{team_ids_key}"
        )
        team = team_map[selected_label]
        st.subheader(team["team_name"])
        st.write(
            f"Tournament: **{team.get('tournament_name', '-')}** | "
            f"Sport: **{team.get('sport', '-')}** | Group: **{team.get('group_name') or '-'}**"
        )
        st.write(
            f"Tournament dates: **{team.get('start_date', '-')} to {team.get('end_date', '-')}**"
        )

        st.subheader("Team player roster")
        players = fetch_players(team["id"])
        if players:
            player_df = pd.DataFrame(players)
            player_columns = [
                c for c in ["name", "email", "team_role", "jersey_number", "player_position"]
                if c in player_df.columns
            ]
            st.dataframe(
                player_df[player_columns].rename(columns={
                    "name": "Player", "email": "Email", "team_role": "Role",
                    "jersey_number": "Jersey #", "player_position": "Position"
                }),
                use_container_width=True,
                hide_index=True,
            )
        else:
            st.info("No players have been added to this team roster yet.")

        st.subheader("Team match schedule")
        match_data, match_code = api_get("/fixtures/my", params={"team_id": team["id"]})
        if match_code != 200:
            show_api_error(match_data, match_code)
            return
        matches = match_data.get("matches", [])
        if not matches:
            st.info("No fixtures have been generated for this team yet.")
        else:
            match_df = pd.DataFrame(matches)
            match_columns = [
                c for c in ["tournament_name", "round", "team1_name", "team2_name",
                            "match_date", "match_start_time", "match_end_time",
                            "venue_name", "status"]
                if c in match_df.columns
            ]
            st.dataframe(
                match_df[match_columns].rename(columns={
                    "tournament_name": "Tournament", "round": "Round",
                    "team1_name": "Team 1", "team2_name": "Team 2",
                    "match_date": "Date", "match_start_time": "Start",
                    "match_end_time": "End", "venue_name": "Venue", "status": "Status"
                }),
                use_container_width=True,
                hide_index=True,
            )
        return

    if role() == "TEAM_CAPTAIN_PLAYER":
        with st.spinner("Loading your teams..."):
            data, code = api_get("/teams")
        teams = data.get("teams", []) if code == 200 else []
        if not teams:
            st.info("No team is linked to your account yet. Ask the organizer to link your team.")
            return
        team_map = {f"{team['team_name']} (#{team['id']})": team for team in teams}
        selected_team = st.selectbox("Select your team", list(team_map), key="captain_team_sel")
        teams = [team_map[selected_team]]
        tid = None
    else:
        with st.spinner("Loading tournaments…"):
            tournaments = fetch_tournaments()
        if not tournaments:
            st.info("No tournaments available.")
            return
        t_map = {f"{t['name']} ({t['sport']})": t for t in tournaments}
        sel_label = st.selectbox("🏆 Select Tournament", list(t_map.keys()))
        sel_t = t_map[sel_label]
        tid = sel_t["id"]
        with st.spinner("Loading teams…"):
            teams = fetch_teams(tid)

    # ── Teams ─────────────────────────────────
    st.markdown('<div class="section-title">🏃 Teams in this Tournament</div>', unsafe_allow_html=True)
    if not teams:
        st.info("No teams registered yet.")
    else:
        df = pd.DataFrame(teams)
        cols_to_show = [c for c in ["id", "team_name", "group_name"] if c in df.columns]
        st.dataframe(df[cols_to_show].rename(columns={"id": "ID", "team_name": "Team Name", "group_name": "Group"}),
                     use_container_width=True, hide_index=True)

    if is_organizer():
        # Add Team
        st.markdown('<div class="section-title">➕ Add New Team</div>', unsafe_allow_html=True)
        with st.form("add_team"):
            team_name = st.text_input("Team Name *")
            group_required = sel_t.get("format") == "GROUP_STAGE"
            group_name = st.text_input("Group Name *" if group_required else "Group Name (optional)")
            if st.form_submit_button("Add Team", type="primary"):
                if not team_name:
                    st.error("Team name required.")
                elif group_required and not group_name.strip():
                    st.error("Group name is required for Group Stage tournaments.")
                else:
                    with st.spinner("Adding team…"):
                        resp, code = api_post("/teams", {
                            "tournament_id": tid, "team_name": team_name,
                            "group_name": group_name.strip() or None,
                        })
                    if code in (200, 201):
                        st.success(f"✅ Team '{team_name}' added!")
                        st.rerun()
                    else:
                        show_api_error(resp, code)

        # Edit / Delete Teams
        if teams:
            st.markdown('<div class="section-title">✏️ Edit / Delete Teams</div>', unsafe_allow_html=True)
            for team in teams:
                with st.expander(f"🏃 {team.get('team_name', '')}"):
                    col_e, col_d = st.columns([3, 1])
                    with col_e:
                        with st.form(f"edit_team_{team['id']}"):
                            new_name = st.text_input("Team Name", value=team.get("team_name", ""))
                            new_group = st.text_input("Group Name", value=team.get("group_name") or "")
                            if st.form_submit_button("💾 Save"):
                                with st.spinner("Updating…"):
                                    resp, code = api_put(f"/teams/{team['id']}", {
                                        "team_name": new_name, "group_name": new_group.strip() or None,
                                    })
                                if code in (200, 201):
                                    st.success("Updated!")
                                    st.rerun()
                                else:
                                    show_api_error(resp, code)
                    with col_d:
                        st.write("")
                        st.write("")
                        if st.button("🗑️ Delete", key=f"del_team_{team['id']}", use_container_width=True):
                            with st.spinner("Deleting…"):
                                resp, code = api_delete(f"/teams/{team['id']}")
                            if code in (200, 204):
                                st.success("Deleted!")
                                st.rerun()
                            else:
                                show_api_error(resp, code)

    # ── Players ───────────────────────────────
    if teams:
        st.markdown('<div class="section-title">⚽ Manage Players</div>', unsafe_allow_html=True)
        team_map = {t.get("team_name", f"Team {t['id']}"): t for t in teams}
        sel_team_label = st.selectbox("Select Team", list(team_map.keys()), key="player_team_sel")
        sel_team = team_map[sel_team_label]
        team_id = sel_team["id"]

        with st.spinner("Loading players…"):
            players = fetch_players(team_id)

        if players:
            df_p = pd.DataFrame(players)
            cols_p = [c for c in ["player_name", "email", "team_role", "jersey_number", "player_position"] if c in df_p.columns]
            st.dataframe(df_p[cols_p].rename(columns={
                "player_name": "Name", "email": "Email", "team_role": "Team role",
                "jersey_number": "Jersey #", "player_position": "Position"
            }), use_container_width=True, hide_index=True)
        else:
            st.info("No players in this team yet.")

        # Add player
        st.markdown("**➕ Add Player**")
        roles_in_use = {p.get("team_role", "PLAYER") for p in players}
        available_roles = ["PLAYER"]
        if "CAPTAIN" not in roles_in_use and not sel_team.get("captain_id"):
            available_roles.append("CAPTAIN")
        if "VICE_CAPTAIN" not in roles_in_use:
            available_roles.append("VICE_CAPTAIN")
        with st.form(f"add_player_{team_id}"):
            pc1, pc2, pc3, pc4 = st.columns(4)
            with pc1:
                p_name = st.text_input("Player name *")
            with pc2:
                p_jersey = st.number_input("Jersey #", min_value=1, max_value=99, step=1)
            with pc3:
                p_pos = st.text_input("Position", placeholder="e.g. Forward, GK")
            with pc4:
                role_labels = {"PLAYER": "Player"}
                if "CAPTAIN" in available_roles:
                    role_labels["CAPTAIN"] = "Captain"
                if "VICE_CAPTAIN" in available_roles:
                    role_labels["VICE_CAPTAIN"] = "Vice Captain"
                p_team_role = st.selectbox("Player role", list(role_labels), format_func=lambda value: role_labels[value], key=f"add_role_{team_id}")
            if st.form_submit_button("Add Player", type="primary"):
                if not p_name:
                    st.error("Player name is required.")
                else:
                    with st.spinner("Adding…"):
                        resp, code = api_post("/players", {
                            "team_id": team_id,
                            "player_name": p_name,
                            "team_role": p_team_role,
                            "jersey_number": int(p_jersey),
                            "player_position": p_pos,
                        })
                    if code in (200, 201):
                        if resp.get("captainAssigned"):
                            st.success("✅ Captain assigned and linked to this player account. They can log in with this email to manage the team and view matches.")
                        elif resp.get("captainPendingSignup"):
                            st.success("✅ Captain role saved. When this player signs up with the same email, their account will get captain access.")
                        else:
                            st.success(f"✅ Player '{p_name}' added!")
                        st.rerun()
                    else:
                        show_api_error(resp, code)

        # Edit/Delete players
        if players:
            st.markdown("**✏️ Edit / Delete Players**")
            for p in players:
                with st.expander(f"⚽ {p.get('player_name','')} — #{p.get('jersey_number','')} {p.get('player_position','')}"):
                    col_e, col_d = st.columns([3, 1])
                    with col_e:
                        with st.form(f"edit_p_{p['id']}"):
                            new_jersey = st.number_input("Jersey #", value=int(p.get("jersey_number") or 1), min_value=1, max_value=99, step=1)
                            new_pos = st.text_input("Position", value=p.get("player_position", ""))
                            if st.form_submit_button("💾 Save"):
                                with st.spinner("Updating…"):
                                    resp, code = api_put(f"/players/{p['id']}", {"jersey_number": int(new_jersey), "player_position": new_pos})
                                if code in (200, 201):
                                    st.success("Updated!")
                                    st.rerun()
                                else:
                                    show_api_error(resp, code)
                    with col_d:
                        st.write("")
                        st.write("")
                        if st.button("🗑️ Delete", key=f"del_p_{p['id']}", use_container_width=True):
                            with st.spinner("Deleting…"):
                                resp, code = api_delete(f"/players/{p['id']}")
                            if code in (200, 204):
                                st.success("Deleted!")
                                st.rerun()
                            else:
                                show_api_error(resp, code)

# ─────────────────────────────────────────────
# PAGE 4 — VENUE MANAGEMENT
# ─────────────────────────────────────────────
def render_venue_selection_for_tournament(tournament, key_prefix):
    if (not tournament.get("match_start_time") or not tournament.get("match_end_time") or
            tournament.get("match_duration_minutes") is None):
        st.warning("Save the tournament scheduling configuration before selecting a venue.")
        st.info("Open Tournaments → Tournament Scheduling Configuration, save match times and duration, then return here.")
        return

    data, code = api_get("/venues/for-tournament", params={"tournament_id": tournament["id"]})
    if code != 200:
        show_api_error(data, code)
        return

    venue_rows = data.get("venues", [])
    if not venue_rows:
        diagnostics = data.get("diagnostics", {})
        st.warning("No venue availability matches this tournament's sport, date range, and match schedule yet.")
        if diagnostics:
            st.caption(
                f"Check summary: {diagnostics.get('venues', 0)} venue(s) have availability records; "
                f"{diagnostics.get('matchingSportSlots', 0)} slot(s) match the sport, "
                f"{diagnostics.get('matchingDateSlots', 0)} also match the tournament dates, "
                f"{diagnostics.get('availableSlots', 0)} are marked available, and "
                f"{diagnostics.get('schedulableSlots', 0)} cover the full configured time window."
            )
        st.info("Make sure the venue sport matches the tournament sport, its availability date is inside the tournament dates, and the venue hours cover the full configured match window.")
        return
    if any(row.get("availability_id") is None for row in venue_rows):
        st.error("Venue availability details are incomplete. Restart the backend, then reload this page.")
        return

    venues_by_id = {}
    slot_by_id = {}
    for row in venue_rows:
        venue = venues_by_id.setdefault(row["id"], {
            "id": row["id"], "venue_name": row["venue_name"], "location": row["location"],
            "venue_type": row["venue_type"], "capacity": row["capacity"],
            "selected": bool(row["selected"]), "availability": [],
        })
        slot = {
            "venue_id": row["id"], "availability_id": row["availability_id"],
            "venue_name": row["venue_name"], "location": row["location"],
            "Date": row["available_date"], "Available from": row["start_time"],
            "Available until": row["end_time"],
            "selected": row.get("selected_availability_id") is not None and
                        int(row["selected_availability_id"]) == int(row["availability_id"]),
        }
        venue["availability"].append(slot)
        slot_by_id[int(row["availability_id"])] = slot

    st.write(f"Sport: **{tournament['sport']}** · Dates: **{tournament['start_date']} to {tournament['end_date']}**")
    st.write(f"Match window: **{tournament['match_start_time']}–{tournament['match_end_time']}** · Duration: **{tournament['match_duration_minutes']} min**")

    labels = {
        venue_id: f"{venue['venue_name']} — {venue['location']} (capacity {venue['capacity']})"
        for venue_id, venue in venues_by_id.items()
    }
    selected = next((venue_id for venue_id, venue in venues_by_id.items() if venue["selected"]), None)
    default_index = list(venues_by_id).index(selected) if selected is not None else 0
    st.subheader("Matching venue availability")
    slot_labels = {
        slot_id: f"{slot['venue_name']} - {slot['location']} | {slot['Date']} | {slot['Available from']}-{slot['Available until']}"
        for slot_id, slot in slot_by_id.items()
    }
    selected_slot = next((slot_id for slot_id, slot in slot_by_id.items() if slot["selected"]), None)
    slot_default_index = list(slot_by_id).index(selected_slot) if selected_slot is not None else 0
    with st.form(f"save_venue_selection_{key_prefix}_{tournament['id']}"):
        selected_slot_id = st.selectbox(
            "Select one matching venue availability", list(slot_by_id), index=slot_default_index,
            format_func=lambda availability_id: slot_labels[availability_id],
            key=f"venue_availability_{key_prefix}_{tournament['id']}",
        )
        submitted = st.form_submit_button("Save venue selection", type="primary")

    if submitted:
        chosen_slot = slot_by_id[selected_slot_id]
        result, save_code = api_post("/venues/selection", {
            "tournament_id": tournament["id"], "venue_ids": [chosen_slot["venue_id"]],
            "availability_id": selected_slot_id,
        })
        if save_code == 200:
            st.success(f"{slot_labels[selected_slot_id]} saved for this tournament.")
            st.rerun()
        else:
            show_api_error(result, save_code)

    for venue in venues_by_id.values():
        with st.expander(f"{venue['venue_name']} — {venue['location']} · {venue['venue_type']} · capacity {venue['capacity']}"):
            st.dataframe(pd.DataFrame(venue["availability"]), hide_index=True)


def show_venue_selection_page():
    st.title("Venue Selection")
    tournaments = fetch_tournaments()
    if not tournaments:
        st.info("Create a tournament before selecting a venue.")
        return
    tournament_map = {
        f"{t['name']} (#{t['id']}) — {t['sport']} · {t['start_date']} to {t['end_date']}": t
        for t in tournaments
    }
    selected_label = st.selectbox("Tournament", list(tournament_map), key="venue_selection_tournament")
    render_venue_selection_for_tournament(tournament_map[selected_label], key_prefix="page")


def show_venues_page():
    st.title("🏟️ Venue Management")
    if not is_venue_coord():
        st.warning("⚠️ Access denied.")
        return

    # Venues list
    st.markdown('<div class="section-title">📋 All Venues</div>', unsafe_allow_html=True)
    with st.spinner("Loading venues…"):
        venues = fetch_venues()

    if venues:
        df = pd.DataFrame(venues)
        cols = [c for c in ["id", "venue_name", "location", "venue_type", "capacity"] if c in df.columns]
        st.dataframe(df[cols].rename(columns={
            "id": "ID", "venue_name": "Venue", "location": "Location",
            "venue_type": "Type", "capacity": "Capacity"
        }), use_container_width=True, hide_index=True)
    else:
        st.info("No venues registered yet.")

    # Add venue
    st.markdown('<div class="section-title">➕ Add Venue</div>', unsafe_allow_html=True)
    with st.form("add_venue"):
        v1, v2 = st.columns(2)
        with v1:
            v_name = st.text_input("Venue Name *")
            v_loc = st.text_input("Location", placeholder="City / Address")
        with v2:
            v_type = st.selectbox("Sport", ["CRICKET", "FOOTBALL", "FUTSAL"])
            v_cap = st.number_input("Capacity", min_value=1, step=100, value=100)
        if st.form_submit_button("Add Venue", type="primary", use_container_width=True):
            if not v_name:
                st.error("Venue name required.")
            else:
                with st.spinner("Adding…"):
                    resp, code = api_post("/venues", {"venue_name": v_name, "location": v_loc, "venue_type": v_type, "capacity": int(v_cap)})
                if code in (200, 201):
                    st.success(f"✅ Venue '{v_name}' added!")
                    st.rerun()
                else:
                    show_api_error(resp, code)

    # Edit/Delete venues
    if venues:
        st.markdown('<div class="section-title">✏️ Edit / Delete Venues</div>', unsafe_allow_html=True)
        for v in venues:
            with st.expander(f"🏟️ {v.get('venue_name','')} — {v.get('location','')}"):
                col_e, col_d = st.columns([3, 1])
                with col_e:
                    with st.form(f"edit_v_{v['id']}"):
                        nv_name = st.text_input("Venue Name", value=v.get("venue_name", ""))
                        nv_loc = st.text_input("Location", value=v.get("location", ""))
                        venue_types = ["CRICKET", "FOOTBALL", "FUTSAL"]
                        nv_type = st.selectbox("Sport", venue_types, index=venue_types.index(v.get("venue_type", "FOOTBALL")))
                        nv_cap = st.number_input("Capacity", value=max(1, int(v.get("capacity") or 1)), min_value=1, step=100)
                        if st.form_submit_button("💾 Save"):
                            with st.spinner("Updating…"):
                                resp, code = api_put(f"/venues/{v['id']}", {"venue_name": nv_name, "location": nv_loc, "venue_type": nv_type, "capacity": int(nv_cap)})
                            if code in (200, 201):
                                st.success("Updated!")
                                st.rerun()
                            else:
                                show_api_error(resp, code)
                with col_d:
                    st.write("")
                    st.write("")
                    if st.button("🗑️ Delete", key=f"del_v_{v['id']}", use_container_width=True):
                        with st.spinner("Deleting…"):
                            resp, code = api_delete(f"/venues/{v['id']}")
                        if code in (200, 204):
                            st.success("Deleted!")
                            st.rerun()
                        else:
                            show_api_error(resp, code)

    # ── Venue Availability ────────────────────
    st.markdown("---")
    st.subheader("📆 Venue Availability")
    if not venues:
        st.info("Add a venue first.")
        return

    venue_map = {v.get("venue_name", f"Venue {v['id']}"): v for v in venues}
    sel_v_label = st.selectbox("Select Venue", list(venue_map.keys()), key="va_venue_sel")
    sel_v = venue_map[sel_v_label]
    vid = sel_v["id"]

    with st.spinner("Loading availability…"):
        availability = fetch_venue_availability(vid)

    if availability:
        df_a = pd.DataFrame(availability)
        cols_a = [c for c in ["id", "available_date", "start_time", "end_time", "is_available"] if c in df_a.columns]
        st.dataframe(df_a[cols_a].rename(columns={
            "id": "ID", "available_date": "Date",
            "start_time": "Start", "end_time": "End",
            "is_available": "Available?"
        }), use_container_width=True, hide_index=True)
    else:
        st.info("No availability slots yet.")

    # Add slot
    st.markdown("**➕ Add Availability Slot**")
    with st.form(f"add_va_{vid}"):
        c1, c2, c3 = st.columns(3)
        with c1:
            va_date = st.date_input("Date", key="va_date")
        with c2:
            va_start = st.time_input("Start Time", value=time(9, 0), key="va_start")
        with c3:
            va_end = st.time_input("End Time", value=time(18, 0), key="va_end")
        if st.form_submit_button("Add Slot", type="primary"):
            with st.spinner("Adding…"):
                resp, code = api_post("/venue-availability", {
                    "venue_id": vid,
                    "available_date": str(va_date),
                    "start_time": str(va_start),
                    "end_time": str(va_end),
                })
            if code in (200, 201):
                st.success("✅ Slot added!")
                st.rerun()
            else:
                show_api_error(resp, code)

    # Edit/Delete availability
    if availability:
        st.markdown("**✏️ Edit / Delete Slots**")
        for slot in availability:
            with st.expander(f"📅 {slot.get('available_date','')} {slot.get('start_time','')}–{slot.get('end_time','')} | Available: {slot.get('is_available')}"):
                col_e, col_d = st.columns([3, 1])
                with col_e:
                    with st.form(f"edit_va_{slot['id']}"):
                        ns_date = st.date_input("Date", value=pd.to_datetime(slot.get("available_date")).date() if slot.get("available_date") else date.today())
                        ns_start = st.text_input("Start Time (HH:MM:SS)", value=str(slot.get("start_time", "09:00:00")))
                        ns_end = st.text_input("End Time (HH:MM:SS)", value=str(slot.get("end_time", "18:00:00")))
                        ns_avail = st.checkbox("Is Available", value=bool(slot.get("is_available", True)))
                        if st.form_submit_button("💾 Save"):
                            with st.spinner("Updating…"):
                                resp, code = api_put(f"/venue-availability/{slot['id']}", {
                                    "available_date": str(ns_date),
                                    "start_time": ns_start,
                                    "end_time": ns_end,
                                    "is_available": ns_avail,
                                })
                            if code in (200, 201):
                                st.success("Updated!")
                                st.rerun()
                            else:
                                show_api_error(resp, code)
                with col_d:
                    st.write("")
                    st.write("")
                    if st.button("🗑️ Delete", key=f"del_va_{slot['id']}", use_container_width=True):
                        with st.spinner("Deleting…"):
                            resp, code = api_delete(f"/venue-availability/{slot['id']}")
                        if code in (200, 204):
                            st.success("Deleted!")
                            st.rerun()
                        else:
                            show_api_error(resp, code)

# ─────────────────────────────────────────────
def show_fixtures_page():
    st.title("⚡ Fixture Generation & Scheduling")
    st.markdown("*Sprint 3 — Main Feature*")

    if not is_organizer():
        st.warning("⚠️ Only Organizers can generate and schedule fixtures.")
        return

    with st.spinner("Loading tournaments…"):
        tournaments = fetch_tournaments()
    if not tournaments:
        st.info("No tournaments found. Create one first.")
        return

    t_map = {f"{t['name']} ({t['sport']} · {t['format']})": t for t in tournaments}
    sel_label = st.selectbox("🏆 Select Tournament", list(t_map.keys()), key="fix_tour_sel")
    sel_t = t_map[sel_label]
    tid = sel_t["id"]

    st.markdown("---")

    # ─── Step 1: Generate Fixtures ──────────
    st.markdown("## 🎲 Step 1 — Generate Fixtures")
    col_gen, col_info = st.columns([1, 2])
    with col_gen:
        generate_clicked = st.button("🎲 Generate Fixtures", type="primary", use_container_width=True)
    with col_info:
        st.info(f"Format: **{sel_t.get('format','?')}** · Sport: **{sel_t.get('sport','?')}**  \n"
                "This will delete any existing fixtures for this tournament and re-generate them.")

    if generate_clicked:
        with st.spinner("Generating fixtures…"):
            resp, code = api_post("/fixtures/generate", {"tournament_id": tid}, timeout=90)
        if code in (200, 201):
            fixtures = resp.get("fixtures", [])
            st.success(f"✅ {len(fixtures)} fixtures generated!")
        else:
            show_api_error(resp, code)
            fixtures = []
    else:
        # Load existing fixtures
        with st.spinner("Loading existing fixtures…"):
            fixtures = fetch_fixtures(tid)

    # Show fixtures grouped by round
    if fixtures:
        rounds = sorted(set(f.get("round", 1) for f in fixtures))
        for rnd in rounds:
            round_fixtures = [f for f in fixtures if f.get("round") == rnd]
            st.markdown(f'<div class="round-header">Round {rnd}</div>', unsafe_allow_html=True)
            for fx in round_fixtures:
                t1 = fx.get("team1_name") or fx.get("team1_id", "TBD")
                t2 = fx.get("team2_name") or fx.get("team2_id", "BYE")
                fixture_group = fx.get("team1_group") or fx.get("team2_group")
                group_badge = f"<span class='badge badge-gray'>Group {fixture_group}</span>" if fixture_group else ""
                sched = ""
                if fx.get("match_date"):
                    sched = f" — 📅 {fx['match_date']} {fx.get('match_start_time','')}–{fx.get('match_end_time','')} 🏟️ {fx.get('venue_name','?')}"
                status = fx.get("status", "UNSCHEDULED")
                badge_cls = {"SCHEDULED": "badge-blue", "COMPLETED": "badge-green", "CANCELLED": "badge-red"}.get(status, "badge-gray")
                st.markdown(
                    f'<div class="card">'
                    f'<b>{t1}</b> <span class="vs-text">vs</span> <b>{t2}</b>'
                    f'{group_badge}'
                    f'<span class="badge {badge_cls}">{status}</span>'
                    f'<span style="color:#94a3b8; font-size:0.85rem;">{sched}</span>'
                    f'</div>',
                    unsafe_allow_html=True
                )
    else:
        st.info("No fixtures yet. Click **Generate Fixtures** above.")

    st.markdown("---")

    # ─── Step 2: Schedule Config Reminder ───
    st.markdown("## ⚙️ Step 2 — Schedule Configuration")
    sched_data, sched_code = api_get(f"/tournaments/{tid}/schedule")
    if sched_code == 200 and sched_data.get("schedule"):
        s = sched_data["schedule"]
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Match Start", s.get("match_start_time", "N/A"))
        c2.metric("Match End", s.get("match_end_time", "N/A"))
        c3.metric("Duration (min)", s.get("match_duration_minutes", "N/A"))
        c4.metric("Min Rest (min)", s.get("minimum_rest_minutes", "N/A"))
        st.success("✅ Schedule configuration is set.")
    else:
        st.warning("⚠️ Schedule configuration is not set for this tournament. Please configure it first.")
        if st.button("→ Go to Tournament Config", key="go_sched_config"):
            st.session_state.current_page = "🏆 Tournaments"
            st.rerun()

    st.markdown("---")

    # ─── Step 3: Auto-Schedule ───────────────
    st.markdown("## ⚡ Step 3 — Auto-Schedule All Matches")
    col_sched, col_sinfo = st.columns([1, 2])
    with col_sched:
        schedule_clicked = st.button("⚡ Auto-Schedule All Matches", type="primary", use_container_width=True)
    with col_sinfo:
        st.info("This assigns dates and times from the Tournament Scheduling Configuration and uses the selected venue's saved availability.")

    if schedule_clicked:
        with st.spinner("⚡ Scheduling fixtures… this may take a moment…"):
            resp, code = api_post("/fixtures/schedule", {"tournament_id": tid})
        if code in (200, 201):
            schedule_data = resp.get("data", resp)
            scheduled = resp.get("scheduled", schedule_data.get("scheduled", []))
            unscheduled = resp.get("unscheduled", schedule_data.get("unscheduled", []))
            scheduled_count = len(scheduled) if isinstance(scheduled, list) else resp.get("scheduled_count", 0)
            st.success(f"✅ Scheduling complete! **{scheduled_count}** fixtures scheduled.")
            if unscheduled:
                st.warning(f"⚠️ **{len(unscheduled)} fixture(s) could not be scheduled** due to availability conflicts:")
                for u in unscheduled:
                    t1 = u.get("team1_name") or u.get("team1_id", "?")
                    t2 = u.get("team2_name") or u.get("team2_id", "?")
                    reason = u.get("reason", "No available slot found")
                    st.markdown(f'<div class="card"><b>{t1}</b> <span class="vs-text">vs</span> <b>{t2}</b> — _{reason}_</div>', unsafe_allow_html=True)
            st.rerun()
        else:
            show_api_error(resp, code)

    st.markdown("---")

    # ─── Step 4: Conflict Check ──────────────
    st.markdown("## ⚠️ Step 4 — Conflict Detection")
    col_chk, col_cinfo = st.columns([1, 2])
    with col_chk:
        conflicts_clicked = st.button("⚠️ Check for Conflicts", use_container_width=True)
    with col_cinfo:
        st.info("Checks for double-booked venues, overlapping team schedules, and insufficient rest time between matches.")

    if conflicts_clicked:
        with st.spinner("Checking conflicts…"):
            conflicts = fetch_conflicts(tid)
        if not conflicts:
            st.success("✅ **No conflicts detected!** Your schedule is clean.")
        else:
            st.error(f"❌ **{len(conflicts)} conflict(s) detected:**")
            for c in conflicts:
                conflict_type = c.get("type", "CONFLICT")
                desc = c.get("description") or c.get("detail") or c.get("message") or str(c)
                st.markdown(
                    f'<div class="card" style="border-left: 4px solid #ef4444;">'
                    f'<b style="color:#f87171;">⚠️ {conflict_type}</b><br/>'
                    f'<span style="color:#e2e8f0;">{desc}</span>'
                    f'</div>',
                    unsafe_allow_html=True
                )

# ─────────────────────────────────────────────
# PAGE 7 — TOURNAMENT PLAN
# ─────────────────────────────────────────────
def show_plan_page():
    if role() == "PLAYER":
        show_teams_page()
        return

    if role() == "TEAM_CAPTAIN_PLAYER":
        st.title("My teams and matches")
        with st.spinner("Loading your teams and match schedule…"):
            team_data, team_code = api_get("/teams")
            match_data, match_code = api_get("/fixtures/my")
        if team_code != 200:
            show_api_error(team_data, team_code)
            return
        captain_teams = team_data.get("teams", [])
        if not captain_teams:
            st.info("Your captain account is not linked to a team yet. Ask the organizer to add your registered user ID to the team roster.")
        else:
            team_df = pd.DataFrame(captain_teams)
            team_cols = [c for c in ["team_name", "tournament_name", "sport", "format", "start_date", "end_date"] if c in team_df.columns]
            st.subheader("Your team details")
            st.dataframe(team_df[team_cols].rename(columns={
                "team_name": "Team", "tournament_name": "Tournament", "sport": "Sport",
                "format": "Format", "start_date": "Start date", "end_date": "End date"
            }), hide_index=True, alt="Teams assigned to your captain account")

            for team in captain_teams:
                with st.expander(f"Roster: {team['team_name']} (#{team['id']})"):
                    players = fetch_players(team["id"])
                    if players:
                        roster = pd.DataFrame(players)
                        roster_cols = [c for c in ["name", "email", "team_role", "jersey_number", "player_position"] if c in roster.columns]
                        st.dataframe(roster[roster_cols].rename(columns={
                            "name": "Player", "email": "Email", "team_role": "Team role",
                            "jersey_number": "Jersey #", "player_position": "Position"
                        }), hide_index=True, alt=f"Roster for {team['team_name']}")
                    else:
                        st.info("No roster players have been added yet.")

        if match_code != 200:
            show_api_error(match_data, match_code)
            return
        matches = match_data.get("matches", [])
        st.subheader("Your team matches")
        if not matches:
            st.info("No fixtures have been generated for your team yet.")
        else:
            matches_df = pd.DataFrame(matches)
            match_cols = [c for c in ["tournament_name", "round", "team1_name", "team2_name", "match_date", "match_start_time", "match_end_time", "venue_name", "status"] if c in matches_df.columns]
            st.dataframe(matches_df[match_cols].rename(columns={
                "tournament_name": "Tournament", "round": "Round", "team1_name": "Team 1",
                "team2_name": "Team 2", "match_date": "Date", "match_start_time": "Start",
                "match_end_time": "End", "venue_name": "Venue", "status": "Status"
            }), hide_index=True, alt="Fixtures and schedule for your teams")
        return

    st.title("📋 Tournament Plan")

    with st.spinner("Loading tournaments…"):
        tournaments = fetch_tournaments()
    if not tournaments:
        st.info("No tournaments available.")
        return

    t_map = {f"{t['name']} ({t['sport']})": t for t in tournaments}
    sel_label = st.selectbox("🏆 Select Tournament", list(t_map.keys()), key="plan_tour_sel")
    sel_t = t_map[sel_label]
    tid = sel_t["id"]

    view_clicked = st.button("📋 View Full Tournament Plan", type="primary")

    # Always reload persisted plan data so changes show after relogin or refresh.
    view_clicked = True
    if not view_clicked and f"plan_{tid}" not in st.session_state:
        st.info("Select a tournament and click **View Full Tournament Plan**.")
        return

    if view_clicked:
        with st.spinner("Loading tournament plan…"):
            data, code = fetch_tournament_plan(tid)
        if code != 200:
            show_api_error(data, code)
            return
        st.session_state[f"plan_{tid}"] = data
    else:
        data = st.session_state.get(f"plan_{tid}", {})

    plan = data.get("plan", data)  # handle different response shapes

    # ── Tournament Header ─────────────────────
    st.markdown(f"""
    <div style='background: linear-gradient(135deg, #0f172a, #1e3a5f); border-radius:16px; padding: 1.5rem 2rem; margin-bottom: 1.5rem; border: 1px solid #334155;'>
        <h2 style='color:#38bdf8; margin:0;'>🏆 {sel_t.get("name","")}</h2>
        <div style='color:#94a3b8; margin-top:4px;'>
            🏅 <b>Sport:</b> {sel_t.get("sport","")} &nbsp;|&nbsp;
            📐 <b>Format:</b> {sel_t.get("format","")} &nbsp;|&nbsp;
            📅 <b>{sel_t.get("start_date","")} → {sel_t.get("end_date","")}</b>
        </div>
    </div>
    """, unsafe_allow_html=True)

    # ── Fixtures from Plan ────────────────────
    fixtures = plan.get("fixtures") if isinstance(plan, dict) else []
    if not fixtures:
        # Fallback to direct fixtures endpoint
        with st.spinner("Loading fixtures…"):
            fixtures = fetch_fixtures(tid)

    if not fixtures:
        st.info("No fixtures found for this tournament.")
        return

    # ── Summary Stats ─────────────────────────
    total = len(fixtures)
    scheduled_count = sum(1 for f in fixtures if f.get("match_date"))
    completed = sum(1 for f in fixtures if f.get("status") == "COMPLETED")
    cancelled = sum(1 for f in fixtures if f.get("status") == "CANCELLED")
    unscheduled = total - scheduled_count

    st.markdown('<div class="section-title">📊 Summary Statistics</div>', unsafe_allow_html=True)
    mc1, mc2, mc3, mc4, mc5 = st.columns(5)
    mc1.metric("🎯 Total Matches", total)
    mc2.metric("📅 Scheduled", scheduled_count)
    mc3.metric("⏳ Unscheduled", unscheduled)
    mc4.metric("✅ Completed", completed)
    mc5.metric("❌ Cancelled", cancelled)

    # ── Styled Fixtures Table ─────────────────
    st.markdown('<div class="section-title">📋 Full Fixture List</div>', unsafe_allow_html=True)

    rows = []
    for fx in fixtures:
        t1 = fx.get("team1_name") or fx.get("team1_id", "TBD")
        t2 = fx.get("team2_name") or fx.get("team2_id", "BYE")
        rows.append({
            "Round": fx.get("round", "?"),
            "Team 1": t1,
            "Team 2": t2,
            "Date": fx.get("match_date", "—"),
            "Start": fx.get("match_start_time", "—"),
            "End": fx.get("match_end_time", "—"),
            "Venue": fx.get("venue_name", "—"),
            "Status": fx.get("status", "UNSCHEDULED"),
        })

    df_plan = pd.DataFrame(rows)

    # Color-code status column
    def color_status(val):
        colors = {
            "SCHEDULED": "background-color: #1e3a8a; color: #bfdbfe;",
            "COMPLETED": "background-color: #14532d; color: #bbf7d0;",
            "CANCELLED": "background-color: #7f1d1d; color: #fecaca;",
            "UNSCHEDULED": "background-color: #374151; color: #d1d5db;",
        }
        return colors.get(val, "")

    styled_df = df_plan.style.applymap(color_status, subset=["Status"])
    st.dataframe(styled_df, use_container_width=True, hide_index=True)

    # ── Bracket Visualization (Knockout) ──────
    if sel_t.get("format") == "KNOCKOUT":
        st.markdown('<div class="section-title">🏆 Knockout Bracket</div>', unsafe_allow_html=True)
        rounds_sorted = sorted(set(f.get("round", 1) for f in fixtures))
        bracket_md = ""
        for rnd in rounds_sorted:
            rnd_label = {1: "Round of 16", 2: "Quarter-Finals", 3: "Semi-Finals", 4: "Final"}.get(rnd, f"Round {rnd}")
            bracket_md += f"\n**{rnd_label}**\n\n"
            rnd_fixtures = [f for f in fixtures if f.get("round") == rnd]
            for fx in rnd_fixtures:
                t1 = fx.get("team1_name") or f"Team#{fx.get('team1_id','?')}"
                t2 = fx.get("team2_name") or f"Team#{fx.get('team2_id','BYE')}"
                status = fx.get("status", "")
                bracket_md += f"```\n┌─ {t1}\n└─ {t2}  [{status}]\n```\n"

        st.markdown(bracket_md)

    # ── Progress bar ──────────────────────────
    if total > 0:
        progress_pct = scheduled_count / total
        st.markdown('<div class="section-title">⏳ Scheduling Progress</div>', unsafe_allow_html=True)
        st.progress(progress_pct, text=f"{scheduled_count}/{total} matches scheduled ({progress_pct*100:.0f}%)")

# ─────────────────────────────────────────────
# SIDEBAR
# ─────────────────────────────────────────────
def build_sidebar():
    with st.sidebar:
        st.markdown("""
        <div style='text-align:center; padding: 1rem 0 0.5rem 0;'>
            <h2 style='margin:0; font-size:1.3rem;'>⚽ Smart Tournament<br/>Planner</h2>
        </div>
        """, unsafe_allow_html=True)

        st.divider()

        user = st.session_state.user
        if user:
            st.markdown(f"""
            <div style='padding: 0.5rem; background:#1e293b; border-radius:8px; margin-bottom:0.5rem;'>
                <div>👤 <b>{user.get("name","")}</b></div>
                <div style='color:#94a3b8; font-size:0.8rem;'>🏷️ {user.get("role","")}</div>
            </div>
            """, unsafe_allow_html=True)

            st.divider()

            # Role-based nav options
            user_role = user.get("role", "")
            nav_options = []

            if user_role in ("ORGANIZER", "ADMIN"):
                nav_options += ["🏆 Tournaments"]
            if user_role in ("ORGANIZER", "ADMIN", "TEAM_CAPTAIN_PLAYER", "PLAYER"):
                nav_options += ["👥 Team Management"]
            if user_role in ("VENUE_COORDINATOR", "ADMIN"):
                nav_options += ["🏟️ Venue Management"]
            if user_role in ("ORGANIZER", "ADMIN"):
                nav_options += ["⚡ Fixtures & Scheduling"]
            if user_role != "PLAYER":
                nav_options += ["📋 Tournament Plan"]

            if user_role in ("ORGANIZER", "ADMIN"):
                nav_options.append("Venue Selection")

            # Ensure current_page is valid
            if st.session_state.current_page not in nav_options:
                # Player accounts should land on the page that shows their
                # linked teams, roster, and fixtures immediately after login.
                st.session_state.current_page = (
                    nav_options[-1] if user_role == "TEAM_CAPTAIN_PLAYER" else nav_options[0]
                )

            selected = st.radio(
                "Navigation",
                nav_options,
                index=nav_options.index(st.session_state.current_page),
                label_visibility="collapsed",
            )
            st.session_state.current_page = selected

            st.divider()

            if st.button("🚪 Logout", use_container_width=True):
                try:
                    requests.post(f"{API_BASE}/users/logout", headers=auth_headers(), timeout=5)
                except Exception:
                    pass
                for key in ["token", "user", "current_page", "auth_restore_attempted_token", "auth_restore_error"]:
                    st.session_state[key] = None
                st.session_state.clear_auth_cookie = True
                st.session_state.current_page = "🏆 Tournaments"
                st.rerun()

# ─────────────────────────────────────────────
# MAIN ROUTER
# ─────────────────────────────────────────────
def main():
    if not st.session_state.token:
        show_auth_page()
        return
    if not st.session_state.user:
        st.error(st.session_state.auth_restore_error or "Could not restore your session.")
        if st.button("Retry backend connection"):
            st.session_state.auth_restore_attempted_token = None
            st.session_state.auth_restore_error = None
            st.rerun()
        return

    build_sidebar()

    page = st.session_state.current_page

    if page == "🏆 Tournaments":
        show_tournaments_page()
    elif page == "👥 Team Management":
        show_teams_page()
    elif page == "🏟️ Venue Management":
        show_venues_page()
    elif page == "⚡ Fixtures & Scheduling":
        show_fixtures_page()
    elif page == "📋 Tournament Plan":
        show_plan_page()
    elif page == "Venue Selection":
        show_venue_selection_page()
    else:
        st.error(f"Unknown page: {page}")

if __name__ == "__main__" or True:
    main()
