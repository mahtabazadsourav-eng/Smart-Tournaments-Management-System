import streamlit as st
import requests

st.set_page_config(
    page_title="Smart Tournament Planner",
    page_icon="⚽",
    layout="centered"
)

API_URL = "http://localhost:5000"

st.title("⚽ Smart Tournament Planner")
st.write("Manage your tournaments easily.")

if "token" not in st.session_state:
    st.session_state["token"] = None

if not st.session_state["token"]:

    page = st.radio("Choose Option", ["Login", "Sign Up"],
                    horizontal=True)

    if page == "Sign Up":

        st.subheader("Create New Account")

        name = st.text_input("Full Name")
        email = st.text_input("Email Address")
        password = st.text_input("Password", type="password")

        role = st.selectbox(
            "Select Role",
            ["TEAM_CAPTAIN_PLAYER", "ORGANIZER", "VENUE_COORDINATOR"]
        )

        if st.button("Sign Up"):

            if not name or not email or not password:
                st.warning("Please fill in all fields.")

            else:
                try:
                    response = requests.post(
                        f"{API_URL}/api/users/register",
                        json={
                            "name": name,
                            "email": email,
                            "password": password,
                            "role": role
                        }
                    )

                    data = response.json()

                    if response.status_code == 201:
                        st.success("Registration successful! Please Login.")
                    else:
                        st.error(data.get("message", "Registration failed"))

                except requests.exceptions.ConnectionError:
                    st.error("Backend server is not running.")

    else:

        st.subheader("User Login")

        email = st.text_input("Email Address")
        password = st.text_input("Password", type="password")

        if st.button("Login"):

            if not email or not password:
                st.warning("Enter email and password.")

            else:
                try:
                    response = requests.post(
                        f"{API_URL}/api/users/login",
                        json={
                            "email": email,
                            "password": password
                        }
                    )

                    data = response.json()

                    if response.status_code == 200:
                        st.session_state["token"] = data["token"]
                        st.session_state["user"] = data["user"]
                        st.rerun()
                    else:
                        st.error(data.get("message", "Login failed"))

                except requests.exceptions.ConnectionError:
                    st.error("Backend server is not running.")

else:

    user = st.session_state["user"]

    st.success("Login successful!")
    st.header("Welcome, " + user["name"])
    st.write("Role:", user["role"])

    if user["role"] == "ORGANIZER":

        st.divider()
        st.header("Organizer Dashboard")

        st.subheader("Create Tournament")

        name = st.text_input("Tournament Name")
        sport = st.selectbox("Sport", ["CRICKET", "FOOTBALL", "FUTSAL"])
        format_type = st.selectbox(
            "Format", ["KNOCKOUT", "LEAGUE", "GROUP_STAGE"]
        )
        start = st.date_input("Start Date")
        end = st.date_input("End Date")

        if st.button("Create Tournament"):

            if not name:
                st.warning("Enter tournament name.")

            elif end < start:
                st.warning("End date cannot be before start date.")

            else:
                response = requests.post(
                    f"{API_URL}/api/tournaments",
                    headers={
                        "Authorization": "Bearer " + st.session_state["token"]
                    },
                    json={
                        "name": name,
                        "sport": sport,
                        "format": format_type,
                        "start_date": str(start),
                        "end_date": str(end)
                    }
                )

                if response.status_code == 201:
                    st.success("Tournament created successfully!")
                else:
                    st.error(response.json().get("message", "Failed"))

        st.divider()

        if st.button("View My Tournaments"):

            response = requests.get(
                f"{API_URL}/api/tournaments",
                headers={
                    "Authorization": "Bearer " + st.session_state["token"]
                }
            )

            if response.status_code == 200:
                st.dataframe(
                    response.json()["tournaments"],
                    use_container_width=True
                )
            else:
                st.error("Could not load tournaments.")

    # Team Management
    st.divider()
    st.header("Team Management")

    if st.button("Load My Tournaments for Team Management"):
        response = requests.get(
            f"{API_URL}/api/tournaments",
            headers={
                "Authorization": "Bearer " + st.session_state["token"]
            }
        )

        if response.status_code == 200:
            st.session_state["team_tournaments"] = response.json()["tournaments"]
        else:
            st.error("Could not load tournaments.")

    tournaments = st.session_state.get("team_tournaments", [])

    if tournaments:
        tournament_options = {
            f'{t["name"]} (ID: {t["id"]})': t["id"]
            for t in tournaments
        }

        selected_tournament = st.selectbox(
            "Select Tournament",
            list(tournament_options.keys())
        )

        tournament_id = tournament_options[selected_tournament]

        st.subheader("Add New Team")

        team_name = st.text_input("Team Name")
        captain_id = st.number_input(
            "Captain User ID",
            min_value=1,
            step=1
        )

        if st.button("Add Team"):
            response = requests.post(
                f"{API_URL}/api/teams",
                headers={
                    "Authorization": "Bearer " + st.session_state["token"]
                },
                json={
                    "tournament_id": tournament_id,
                    "team_name": team_name,
                    "captain_id": int(captain_id)
                }
            )

            if response.status_code == 201:
                st.success("Team added successfully!")
            else:
                st.error(response.json().get("message", "Failed to add team"))

        st.subheader("View Teams")

        if st.button("View Teams"):
            response = requests.get(
                f"{API_URL}/api/teams",
                params={"tournament_id": tournament_id},
                headers={
                    "Authorization": "Bearer " + st.session_state["token"]
                }
            )

            if response.status_code == 200:
                st.dataframe(
                    response.json()["teams"],
                    use_container_width=True
                )
            else:
                st.error("Could not load teams.")

    else:
        st.info("Load your tournaments first to manage teams.")
            # Edit and Delete Team
    st.divider()
    st.subheader("Edit or Delete Team")

    team_id = st.number_input(
        "Team ID",
        min_value=1,
        step=1
    )

    new_team_name = st.text_input("New Team Name")

    new_captain_id = st.number_input(
        "New Captain User ID",
        min_value=1,
        step=1
    )

    if st.button("Update Team"):
        response = requests.put(
            f"{API_URL}/api/teams/{int(team_id)}",
            headers={
                "Authorization": "Bearer " + st.session_state["token"]
            },
            json={
                "team_name": new_team_name,
                "captain_id": int(new_captain_id)
            }
        )

        if response.status_code == 200:
            st.success("Team updated successfully!")
        else:
            st.error(response.json().get("message", "Update failed"))

    if st.button("Delete Team"):
        response = requests.delete(
            f"{API_URL}/api/teams/{int(team_id)}",
            headers={
                "Authorization": "Bearer " + st.session_state["token"]
            }
        )

        if response.status_code == 200:
            st.success("Team deleted successfully!")
        else:
            st.error(response.json().get("message", "Delete failed"))
    # Player Management
    st.divider()
    st.header("Player Management")

    team_id = st.number_input(
        "Team ID for Player Management",
        min_value=1,
        step=1,
        key="player_team_id"
    )

    st.subheader("Add Player")

    player_name = st.text_input("Player Name")

    jersey_number = st.number_input(
        "Jersey Number",
        min_value=1,
        step=1
    )

    player_position = st.text_input("Player Position")

    if st.button("Add Player"):
        response = requests.post(
            f"{API_URL}/api/players",
            headers={
                "Authorization": "Bearer " + st.session_state["token"]
            },
            json={
                "team_id": int(team_id),
                "player_name": player_name,
                "jersey_number": int(jersey_number),
                "player_position": player_position
            }
        )

        if response.status_code == 201:
            st.success("Player added successfully!")
        else:
            st.error(response.json().get("message", "Failed to add player"))

    st.subheader("View Players")

    if st.button("View Players"):
        response = requests.get(
            f"{API_URL}/api/players",
            params={"team_id": int(team_id)},
            headers={
                "Authorization": "Bearer " + st.session_state["token"]
            }
        )

        if response.status_code == 200:
            st.dataframe(
                response.json()["players"],
                use_container_width=True
            )
        else:
            st.error(response.json().get("message", "Failed to load players"))

    st.subheader("Edit or Remove Player")

    player_id = st.number_input(
        "Player Record ID",
        min_value=1,
        step=1
    )

    updated_jersey = st.number_input(
        "Updated Jersey Number",
        min_value=1,
        step=1
    )

    updated_position = st.text_input("Updated Player Position")

    if st.button("Update Player"):
        response = requests.put(
            f"{API_URL}/api/players/{int(player_id)}",
            headers={
                "Authorization": "Bearer " + st.session_state["token"]
            },
            json={
                "jersey_number": int(updated_jersey),
                "player_position": updated_position
            }
        )

        if response.status_code == 200:
            st.success("Player updated successfully!")
        else:
            st.error(response.json().get("message", "Update failed"))

    if st.button("Remove Player"):
        response = requests.delete(
            f"{API_URL}/api/players/{int(player_id)}",
            headers={
                "Authorization": "Bearer " + st.session_state["token"]
            }
        )

        if response.status_code == 200:
            st.success("Player removed successfully!")
        else:
            st.error(response.json().get("message", "Remove failed"))
           # Venue Management
    st.divider()
    st.header("Venue Management")

    st.subheader("Add Venue")

    venue_name = st.text_input("Venue Name")
    venue_location = st.text_input("Venue Location")

    venue_type = st.selectbox(
        "Venue Type",
        ["CRICKET", "FOOTBALL", "FUTSAL"]
    )

    venue_capacity = st.number_input(
        "Venue Capacity",
        min_value=1,
        step=1
    )

    if st.button("Add Venue"):
        response = requests.post(
            f"{API_URL}/api/venues",
            headers={
                "Authorization": "Bearer " + st.session_state["token"]
            },
            json={
                "venue_name": venue_name,
                "location": venue_location,
                "venue_type": venue_type,
                "capacity": int(venue_capacity)
            }
        )

        if response.status_code == 201:
            st.success("Venue added successfully!")
        else:
            st.error(response.json().get("message", "Failed to add venue"))

    st.subheader("View Venues")

    if st.button("View Venues"):
        response = requests.get(
            f"{API_URL}/api/venues",
            headers={
                "Authorization": "Bearer " + st.session_state["token"]
            }
        )

        if response.status_code == 200:
            st.dataframe(
                response.json()["venues"],
                use_container_width=True
            )
        else:
            st.error(response.json().get("message", "Failed to load venues"))

    st.subheader("Edit Venue")

    venue_id = st.number_input(
        "Venue ID",
        min_value=1,
        step=1
    )

    updated_venue_name = st.text_input("Updated Venue Name")
    updated_location = st.text_input("Updated Venue Location")

    updated_venue_type = st.selectbox(
        "Updated Venue Type",
        ["CRICKET", "FOOTBALL", "FUTSAL"]
    )

    updated_capacity = st.number_input(
        "Updated Venue Capacity",
        min_value=1,
        step=1
    )

    if st.button("Update Venue"):
        response = requests.put(
            f"{API_URL}/api/venues/{int(venue_id)}",
            headers={
                "Authorization": "Bearer " + st.session_state["token"]
            },
            json={
                "venue_name": updated_venue_name,
                "location": updated_location,
                "venue_type": updated_venue_type,
                "capacity": int(updated_capacity)
            }
        )

        if response.status_code == 200:
            st.success("Venue updated successfully!")
        else:
            st.error(response.json().get("message", "Update failed"))

    st.subheader("Delete Venue")

    delete_venue_id = st.number_input(
        "Venue ID to Delete",
        min_value=1,
        step=1
    )

    if st.button("Delete Venue"):
        response = requests.delete(
            f"{API_URL}/api/venues/{int(delete_venue_id)}",
            headers={
                "Authorization": "Bearer " + st.session_state["token"]
            }
        )

        if response.status_code == 200:
            st.success("Venue deleted successfully!")
        else:
            st.error(response.json().get("message", "Delete failed"))     
                # Venue Availability Management
    st.divider()
    st.header("Venue Availability & Time Slots")

    st.subheader("Add Venue Availability")

    availability_venue_id = st.number_input(
        "Venue ID",
        min_value=1,
        step=1,
        key="availability_venue_id"
    )

    available_date = st.date_input(
        "Available Date",
        key="available_date"
    )

    start_time = st.time_input(
        "Start Time",
        key="availability_start_time"
    )

    end_time = st.time_input(
        "End Time",
        key="availability_end_time"
    )

    if st.button("Add Availability"):
        response = requests.post(
            f"{API_URL}/api/venue-availability",
            headers={
                "Authorization": "Bearer " + st.session_state["token"]
            },
            json={
                "venue_id": int(availability_venue_id),
                "available_date": str(available_date),
                "start_time": str(start_time),
                "end_time": str(end_time)
            }
        )

        if response.status_code == 201:
            st.success("Venue availability added successfully!")
        else:
            st.error(response.json().get("message", "Failed to add availability"))

    st.subheader("View Venue Availability")

    if st.button("View Availability"):
        response = requests.get(
            f"{API_URL}/api/venue-availability",
            headers={
                "Authorization": "Bearer " + st.session_state["token"]
            }
        )

        if response.status_code == 200:
            st.dataframe(
                response.json()["availability"],
                use_container_width=True
            )
        else:
            st.error(response.json().get("message", "Failed to load availability"))

    st.subheader("Update Venue Availability")

    update_availability_id = st.number_input(
        "Availability ID to Update",
        min_value=1,
        step=1,
        key="update_availability_id"
    )

    update_date = st.date_input(
        "Updated Date",
        key="update_availability_date"
    )

    update_start_time = st.time_input(
        "Updated Start Time",
        key="update_start_time"
    )

    update_end_time = st.time_input(
        "Updated End Time",
        key="update_end_time"
    )

    update_is_available = st.selectbox(
        "Availability Status",
        [True, False],
        format_func=lambda x: "Available" if x else "Not Available"
    )

    if st.button("Update Availability"):
        response = requests.put(
            f"{API_URL}/api/venue-availability/{int(update_availability_id)}",
            headers={
                "Authorization": "Bearer " + st.session_state["token"]
            },
            json={
                "available_date": str(update_date),
                "start_time": str(update_start_time),
                "end_time": str(update_end_time),
                "is_available": update_is_available
            }
        )

        if response.status_code == 200:
            st.success("Availability updated successfully!")
        else:
            st.error(response.json().get("message", "Update failed"))

    st.subheader("Delete Venue Availability")

    delete_availability_id = st.number_input(
        "Availability ID to Delete",
        min_value=1,
        step=1,
        key="delete_availability_id"
    )

    if st.button("Delete Availability"):
        response = requests.delete(
            f"{API_URL}/api/venue-availability/{int(delete_availability_id)}",
            headers={
                "Authorization": "Bearer " + st.session_state["token"]
            }
        )

        if response.status_code == 200:
            st.success("Availability deleted successfully!")
        else:
            st.error(response.json().get("message", "Delete failed"))
             # Team Availability Management
    st.divider()
    st.header("Team Availability & Time Slots")

    st.subheader("Add Team Availability")

    availability_team_id = st.number_input(
        "Team ID",
        min_value=1,
        step=1,
        key="team_availability_id"
    )

    team_available_date = st.date_input(
        "Available Date",
        key="team_available_date"
    )

    team_start_time = st.time_input(
        "Start Time",
        key="team_start_time"
    )

    team_end_time = st.time_input(
        "End Time",
        key="team_end_time"
    )

    if st.button("Add Team Availability"):
        response = requests.post(
            f"{API_URL}/api/team-availability",
            headers={
                "Authorization": "Bearer " + st.session_state["token"]
            },
            json={
                "team_id": int(availability_team_id),
                "available_date": str(team_available_date),
                "start_time": str(team_start_time),
                "end_time": str(team_end_time)
            }
        )

        if response.status_code == 201:
            st.success("Team availability added successfully!")
        else:
            st.error(response.json().get("message", "Failed to add availability"))

    st.subheader("View Team Availability")

    if st.button("View Team Availability"):
        response = requests.get(
            f"{API_URL}/api/team-availability",
            headers={
                "Authorization": "Bearer " + st.session_state["token"]
            }
        )

        if response.status_code == 200:
            st.dataframe(
                response.json()["availability"],
                use_container_width=True
            )
        else:
            st.error(response.json().get("message", "Failed to load availability"))

    st.subheader("Update Team Availability")

    update_team_availability_id = st.number_input(
        "Availability ID to Update",
        min_value=1,
        step=1,
        key="update_team_availability_id"
    )

    update_team_date = st.date_input(
        "Updated Date",
        key="update_team_date"
    )

    update_team_start = st.time_input(
        "Updated Start Time",
        key="update_team_start"
    )

    update_team_end = st.time_input(
        "Updated End Time",
        key="update_team_end"
    )

    update_team_status = st.selectbox(
        "Team Availability Status",
        [True, False],
        format_func=lambda x: "Available" if x else "Not Available",
        key="update_team_status"
    )

    if st.button("Update Team Availability"):
        response = requests.put(
            f"{API_URL}/api/team-availability/{int(update_team_availability_id)}",
            headers={
                "Authorization": "Bearer " + st.session_state["token"]
            },
            json={
                "available_date": str(update_team_date),
                "start_time": str(update_team_start),
                "end_time": str(update_team_end),
                "is_available": update_team_status
            }
        )

        if response.status_code == 200:
            st.success("Team availability updated successfully!")
        else:
            st.error(response.json().get("message", "Update failed"))

    st.subheader("Delete Team Availability")

    delete_team_availability_id = st.number_input(
        "Availability ID to Delete",
        min_value=1,
        step=1,
        key="delete_team_availability_id"
    )

    if st.button("Delete Team Availability"):
        response = requests.delete(
            f"{API_URL}/api/team-availability/{int(delete_team_availability_id)}",
            headers={
                "Authorization": "Bearer " + st.session_state["token"]
            }
        )

        if response.status_code == 200:
            st.success("Team availability deleted successfully!")
        else:
            st.error(response.json().get("message", "Delete failed")) 
            # Tournament Scheduling
    st.divider()
    st.header("Tournament Scheduling")

    st.subheader("Set Match Schedule")

    schedule_tournament_id = st.number_input(
        "Tournament ID for Scheduling",
        min_value=1,
        step=1,
        key="schedule_tournament_id"
    )

    match_start_time = st.time_input(
        "Match Start Time",
        key="match_start_time"
    )

    match_end_time = st.time_input(
        "Match End Time",
        key="match_end_time"
    )

    match_duration = st.number_input(
        "Match Duration (Minutes)",
        min_value=1,
        value=90,
        step=5,
        key="match_duration"
    )

    minimum_rest = st.number_input(
        "Minimum Rest Time (Minutes)",
        min_value=0,
        value=30,
        step=5,
        key="minimum_rest"
    )

    if st.button("Update Tournament Schedule"):
        response = requests.put(
            f"{API_URL}/api/tournaments/{int(schedule_tournament_id)}/schedule",
            headers={
                "Authorization": "Bearer " + st.session_state["token"]
            },
            json={
                "match_start_time": str(match_start_time),
                "match_end_time": str(match_end_time),
                "match_duration_minutes": int(match_duration),
                "minimum_rest_minutes": int(minimum_rest)
            }
        )

        if response.status_code == 200:
            st.success("Tournament schedule updated successfully!")
        else:
            st.error(response.json().get("message", "Failed to update schedule"))
            st.subheader("View Tournament Schedule")

    if st.button("View Schedule"):
        response = requests.get(
            f"{API_URL}/api/tournaments/{int(schedule_tournament_id)}/schedule",
            headers={
                "Authorization": "Bearer " + st.session_state["token"]
            }
        )

        if response.status_code == 200:
            schedule = response.json()["schedule"]

            st.success("Tournament schedule retrieved successfully!")

            st.write("Tournament Name:", schedule["name"])
            st.write("Match Start Time:", schedule["match_start_time"])
            st.write("Match End Time:", schedule["match_end_time"])
            st.write("Match Duration:", schedule["match_duration_minutes"], "minutes")
            st.write("Minimum Rest Time:", schedule["minimum_rest_minutes"], "minutes")

        else:
            st.error(response.json().get("message", "Failed to retrieve schedule"))      
    if st.button("Logout"):
        try:
            requests.post(
                f"{API_URL}/api/users/logout",
                headers={
                    "Authorization": "Bearer " + st.session_state["token"]
                }
            )
        finally:
            st.session_state["token"] = None
            st.session_state["user"] = None
            st.rerun()

st.divider()
st.write("CSE412 Project sourav Group 5")