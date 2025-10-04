import base64
from locust import HttpUser, task, between
from random import choice

class WebUser(HttpUser):
    # equivalent to min_wait=0, max_wait=0
    wait_time = between(0, 0)

    @task
    def load(self):
        # Encode user:password as base64 (Python 3 way)
        credentials = "user:password".encode("utf-8")
        base64string = base64.b64encode(credentials).decode("utf-8")

        # Fetch catalogue and pick a random item
        catalogue = self.client.get("/catalogue").json()
        if not catalogue:
            return  # avoid crash if catalogue is empty
        category_item = choice(catalogue)
        item_id = category_item["id"]

        # Simulate a typical user flow
        self.client.get("/")
        self.client.get("/login", headers={"Authorization": f"Basic {base64string}"})
        self.client.get("/category.html")
        self.client.get(f"/detail.html?id={item_id}")
        self.client.delete("/cart")
        self.client.post("/cart", json={"id": item_id, "quantity": 1})
        self.client.get("/basket.html")
        self.client.post("/orders")
