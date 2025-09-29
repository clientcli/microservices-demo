FROM python:3.11-slim
# Install locust
RUN pip install --no-cache-dir locust==2.20.0 faker pyzmq

ADD locustfile.py /config/locustfile.py
ADD runLocust.sh /usr/local/bin/runLocust.sh

ENV LOCUST_FILE=/config/locustfile.py

EXPOSE 8089

ENTRYPOINT ["/usr/local/bin/runLocust.sh"]
