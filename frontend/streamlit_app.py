import os
import requests
import streamlit as st

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")

st.set_page_config(page_title="HR Resource Query Chatbot", page_icon="🤖", layout="wide")

st.title("HR Resource Query Chatbot")

with st.sidebar:
    st.header("Settings")
    backend = st.text_input("Backend URL", value=BACKEND_URL)
    st.markdown("Examples:")
    examples = [
        "Find Python developers with 3+ years experience",
        "Who has worked on healthcare projects?",
        "Suggest people for a React Native project",
        "Find developers who know both AWS and Docker",
    ]
    for ex in examples:
        if st.button(ex):
            st.session_state.setdefault("messages", [])
            st.session_state["input"] = ex

st.session_state.setdefault("messages", [])

# Chat input
if "input" not in st.session_state:
    st.session_state["input"] = ""

with st.form("chat_form", clear_on_submit=True):
    user_input = st.text_input("Your query", value=st.session_state.get("input", ""))
    submitted = st.form_submit_button("Send")

if submitted and user_input.strip():
    st.session_state["messages"].append({"role": "user", "content": user_input})
    try:
        resp = requests.post(f"{backend}/chat", json={"message": user_input}, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        st.session_state["messages"].append({"role": "assistant", "content": data["answer"], "candidates": data["top_candidates"]})
    except Exception as e:
        st.session_state["messages"].append({"role": "assistant", "content": f"Error: {e}"})

# Display chat
for msg in st.session_state["messages"]:
    if msg["role"] == "user":
        st.chat_message("user").write(msg["content"])
    else:
        with st.chat_message("assistant"):
            st.write(msg["content"])
            candidates = msg.get("candidates", [])
            if candidates:
                st.subheader("Top Candidates")
                for c in candidates:
                    emp = c["employee"]
                    cols = st.columns([2, 1, 2, 2])
                    with cols[0]:
                        st.markdown(f"**{emp['name']}**")
                        st.caption(", ".join(emp["skills"]))
                    with cols[1]:
                        st.metric("Experience", f"{emp['experience_years']} yrs")
                    with cols[2]:
                        st.text("Projects:\n- " + "\n- ".join(emp["projects"]))
                    with cols[3]:
                        st.badge(emp["availability"], variant="green" if emp["availability"] == "available" else "gray")

st.divider()

st.caption("Backend: ")
st.code(backend, language="text")