'use client';

import React from 'react';
import { Card, CardContent, Box, Typography, useTheme } from '@mui/material';
import { SparkLineChart } from '@mui/x-charts/SparkLineChart';

interface StatCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  color: 'primary' | 'success' | 'error' | 'warning';
  subtitle?: string;
  /** Optional recent history for this stat; rendered as a sparkline under the subtitle. */
  trend?: number[];
  trendValueFormatter?: (value: number | null) => string;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, icon, color, subtitle, trend, trendValueFormatter }) => {
  const theme = useTheme();
  // A constant series (all zeros, or a flat expected-income line) renders as a
  // solid filled block that reads like a progress bar, so suppress it entirely.
  const showTrend =
    Array.isArray(trend) && trend.length >= 2 && trend.some((value) => value !== trend[0]);

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Box>
            <Typography variant="h4" color={`${color}.main`} fontWeight="bold">
              {value}
            </Typography>
            <Typography variant="h6" color="text.primary" gutterBottom>
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="body2" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </Box>
          <Box
            sx={{
              backgroundColor: `${color}.light`,
              borderRadius: 2,
              p: 1.5,
              color: `${color}.main`,
            }}
          >
            {icon}
          </Box>
        </Box>
        {showTrend && (
          <Box sx={{ mt: 1, height: 36 }}>
            <SparkLineChart
              data={trend}
              height={36}
              area
              showHighlight
              showTooltip
              color={theme.palette[color].main}
              valueFormatter={trendValueFormatter}
              margin={{ top: 4, bottom: 4, left: 0, right: 0 }}
            />
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default StatCard;
