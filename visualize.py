import matplotlib.pyplot as plt
import numpy as np

# Data in seconds
services = ["Orders Sidecar", "Payment Sidecar", "All Sidecars"]
mins = [263.393, 263.420, 263.393]
maxs = [293.498, 295.478, 295.478]
means = [274.113, 274.964, 274.453]

# x positions
x = np.arange(len(services))

# Create figure
fig, ax = plt.subplots(figsize=(5,4))

# Plot lines for min, mean, max
ax.plot(x, mins, marker='o', label="Min", color="#aec7e8")
ax.plot(x, means, marker='s', label="Mean", color="#98df8a")
ax.plot(x, maxs, marker='^', label="Max", color="#ffbb78")

# Labels and title
ax.set_ylabel("Proof Generation Time (seconds)")
ax.set_title("Proof Generation Time by the Sidecars")
ax.set_xticks(x)
ax.set_xticklabels(services)
ax.set_ylim(260, 300)
ax.margins(x=0.05)
ax.legend()

# Grid for readability
ax.grid(axis="y", linestyle="--", alpha=0.7)

# Annotate points
for i, service in enumerate(services):
    ax.annotate(f"{mins[i]:.2f}", (x[i], mins[i]), textcoords="offset points", xytext=(0,5), ha='center')
    ax.annotate(f"{means[i]:.2f}", (x[i], means[i]), textcoords="offset points", xytext=(0,5), ha='center')
    ax.annotate(f"{maxs[i]:.2f}", (x[i], maxs[i]), textcoords="offset points", xytext=(0,5), ha='center')

plt.tight_layout()
plt.show()