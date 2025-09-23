#!/usr/bin/env python3
"""
Script to analyze ZKP proof generation data lengths from log files.
Usage:
  python3 analyze_data_lengths.py [log_file_path]
  python3 analyze_data_lengths.py [log_file_path] --service orders
  python3 analyze_data_lengths.py [log_file_path] --service payment
"""

import sys
import csv
import statistics
from datetime import datetime
from collections import defaultdict
import argparse


def analyze_log_file(log_file_path, service_filter=None):
    """Analyze the proof generation log file for data length statistics."""
    
    if not log_file_path:
        log_file_path = 'src/poe-sidecar/logs/proof_generation_time.log'
    
    try:
        with open(log_file_path, 'r') as f:
            lines = f.readlines()
    except FileNotFoundError:
        print(f"Log file not found: {log_file_path}")
        return
    
    if not lines:
        print("No data found in log file")
        return
    
    # Parse log entries
    entries = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        parts = line.split(',')
        if len(parts) >= 6:
            try:
                timestamp = parts[0]
                job_id = parts[1]
                duration = float(parts[2])
                preimage_bytes = int(parts[3])
                metadata_bytes = int(parts[4])
                total_bytes = int(parts[5])
                service_name = parts[6] if len(parts) > 6 else 'unknown'
                
                entries.append({
                    'timestamp': timestamp,
                    'job_id': job_id,
                    'duration': duration,
                    'preimage_bytes': preimage_bytes,
                    'metadata_bytes': metadata_bytes,
                    'total_bytes': total_bytes,
                    'service_name': service_name
                })
            except (ValueError, IndexError) as e:
                print(f"Error parsing line: {line} - {e}")
                continue
    
    if not entries:
        print("No valid entries found in log file")
        return

    # Optional service filter (e.g., only 'orders' or only 'payment')
    if service_filter:
        entries = [e for e in entries if e.get('service_name') == service_filter]
        if not entries:
            print(f"No entries found for service '{service_filter}'")
            return
    
    # Calculate statistics
    print("=" * 80)
    hdr = "ZKP PROOF GENERATION DATA LENGTH ANALYSIS"
    if service_filter:
        hdr += f" — SERVICE: {service_filter}"
    print(hdr)
    print("=" * 80)
    print(f"Total proof generations: {len(entries)}")
    print(f"Analysis period: {entries[0]['timestamp']} to {entries[-1]['timestamp']}")
    print()
    
    # Overall statistics
    durations = [e['duration'] for e in entries]
    preimage_sizes = [e['preimage_bytes'] for e in entries]
    metadata_sizes = [e['metadata_bytes'] for e in entries]
    total_sizes = [e['total_bytes'] for e in entries]
    
    print("OVERALL STATISTICS:")
    print("-" * 40)
    print(f"Proof Generation Time (seconds):")
    print(f"  Min: {min(durations):.3f}s")
    print(f"  Max: {max(durations):.3f}s")
    print(f"  Mean: {statistics.mean(durations):.3f}s")
    print(f"  Median: {statistics.median(durations):.3f}s")
    print(f"  Std Dev: {statistics.stdev(durations):.3f}s" if len(durations) > 1 else "  Std Dev: N/A")
    print()
    
    print(f"Preimage Data Size (bytes):")
    print(f"  Min: {min(preimage_sizes)} bytes")
    print(f"  Max: {max(preimage_sizes)} bytes")
    print(f"  Mean: {statistics.mean(preimage_sizes):.1f} bytes")
    print(f"  Median: {statistics.median(preimage_sizes):.1f} bytes")
    print(f"  Std Dev: {statistics.stdev(preimage_sizes):.1f} bytes" if len(preimage_sizes) > 1 else "  Std Dev: N/A")
    print()
    
    print(f"Metadata Size (bytes):")
    print(f"  Min: {min(metadata_sizes)} bytes")
    print(f"  Max: {max(metadata_sizes)} bytes")
    print(f"  Mean: {statistics.mean(metadata_sizes):.1f} bytes")
    print(f"  Median: {statistics.median(metadata_sizes):.1f} bytes")
    print(f"  Std Dev: {statistics.stdev(metadata_sizes):.1f} bytes" if len(metadata_sizes) > 1 else "  Std Dev: N/A")
    print()
    
    print(f"Total Data Size (bytes):")
    print(f"  Min: {min(total_sizes)} bytes")
    print(f"  Max: {max(total_sizes)} bytes")
    print(f"  Mean: {statistics.mean(total_sizes):.1f} bytes")
    print(f"  Median: {statistics.median(total_sizes):.1f} bytes")
    print(f"  Std Dev: {statistics.stdev(total_sizes):.1f} bytes" if len(total_sizes) > 1 else "  Std Dev: N/A")
    print()
    
    # Service-specific statistics
    service_stats = defaultdict(list)
    for entry in entries:
        service_stats[entry['service_name']].append(entry)
    
    if len(service_stats) > 1 and not service_filter:
        print("SERVICE-SPECIFIC STATISTICS:")
        print("-" * 40)
        for service_name, service_entries in service_stats.items():
            service_durations = [e['duration'] for e in service_entries]
            service_total_sizes = [e['total_bytes'] for e in service_entries]
            
            print(f"{service_name.upper()} Service:")
            print(f"  Count: {len(service_entries)} proofs")
            print(f"  Avg Duration: {statistics.mean(service_durations):.3f}s")
            print(f"  Avg Data Size: {statistics.mean(service_total_sizes):.1f} bytes")
            print(f"  Min Data Size: {min(service_total_sizes)} bytes")
            print(f"  Max Data Size: {max(service_total_sizes)} bytes")
            print()

    # Focused comparison for orders vs payment
    if not service_filter:
        orders_entries = service_stats.get('orders', [])
        payment_entries = service_stats.get('payment', [])
        if orders_entries or payment_entries:
            print("FOCUSED COMPARISON (orders vs payment):")
            print("-" * 40)
            def summarize(name, es):
                if not es:
                    print(f"{name:8}: no data")
                    return
                durs = [e['duration'] for e in es]
                sizes = [e['total_bytes'] for e in es]
                print(f"{name:8}: count={len(es):4}  avg_time={statistics.mean(durs):.3f}s  avg_size={statistics.mean(sizes):.1f} bytes  p50={statistics.median(durs):.3f}s  p95={sorted(durs)[int(0.95*len(durs))-1]:.3f}s")
            summarize('orders', orders_entries)
            summarize('payment', payment_entries)
            print()
    
    # Data size vs time correlation
    print("DATA SIZE vs GENERATION TIME CORRELATION:")
    print("-" * 40)
    
    # Group by data size ranges
    size_ranges = [
        (0, 100, "0-100 bytes"),
        (100, 500, "100-500 bytes"),
        (500, 1000, "500-1000 bytes"),
        (1000, 2000, "1KB-2KB"),
        (2000, float('inf'), "2KB+")
    ]
    
    for min_size, max_size, label in size_ranges:
        range_entries = [e for e in entries if min_size <= e['total_bytes'] < max_size]
        if range_entries:
            range_durations = [e['duration'] for e in range_entries]
            avg_duration = statistics.mean(range_durations)
            print(f"  {label:12}: {len(range_entries):3} proofs, avg time: {avg_duration:.3f}s")
    
    print()
    print("RECENT ENTRIES (last 10):")
    print("-" * 40)
    print("Timestamp                    | Job ID              | Duration | Data Size | Service")
    print("-" * 80)
    
    for entry in entries[-10:]:
        timestamp_short = entry['timestamp'][:19]  # Remove milliseconds
        print(f"{timestamp_short:27} | {entry['job_id']:18} | {entry['duration']:8.3f}s | {entry['total_bytes']:9} bytes | {entry['service_name']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Analyze PoE proof generation data lengths")
    parser.add_argument('log_file_path', nargs='?', default=None, help='Path to log file')
    parser.add_argument('--service', choices=['orders', 'payment'], help='Filter analysis to a single service')
    args = parser.parse_args()

    analyze_log_file(args.log_file_path, service_filter=args.service)
